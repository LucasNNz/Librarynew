import type { Env, FastPushBody, MaterializeJob } from "../types";
import { id, nowMs, safeFilenameFromUrl } from "./ids";
import { limitedStream, safeRemoteUrl, transientHttpStatus } from "./net";
import { createSignedCandidateUrl } from "./auth";

function normalizeTags(tags: unknown) {
  return Array.isArray(tags) ? [...new Set(tags.map(String).map(value => value.trim()).filter(Boolean))].slice(0, 40) : [];
}

export async function fastPush(request: Request, env: Env) {
  const body = await request.json<FastPushBody>().catch(() => ({}));
  const rows = Array.isArray(body.urls)
    ? body.urls.filter(item => typeof item?.url === "string" && safeRemoteUrl(item.url) !== null).slice(0, 200)
    : [];
  if (!rows.length) return { error: "NO_VALID_URLS", status: 400 } as const;

  const operationId = id("OP");
  const created = nowMs();
  const operation = env.DB.prepare(`INSERT INTO v2_ingest_operations
    (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(operationId, "FAST_PUSH", "QUEUED", rows.length, 0, 0, "{}", created, created);

  const jobs: MessageSendRequest<MaterializeJob>[] = [];
  const inserts: D1PreparedStatement[] = [operation];
  for (const row of rows) {
    const candidateId = id("CAND");
    const tags = normalizeTags(row.tags);
    inserts.push(env.DB.prepare(`INSERT INTO v2_ingest_candidates
      (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
        candidateId,
        operationId,
        row.url,
        row.projectId || null,
        row.itemId || null,
        row.universe || "",
        row.subject || "",
        JSON.stringify(tags),
        "QUEUED",
        created,
        created,
      ));
    jobs.push({ body: { operationId, candidateId, url: row.url!, projectId: row.projectId, itemId: row.itemId, universe: row.universe, subject: row.subject, tags } });
  }

  await env.DB.batch(inserts);
  for (let offset = 0; offset < jobs.length; offset += 100) await env.MATERIALIZE_QUEUE.sendBatch(jobs.slice(offset, offset + 100));
  return { accepted: rows.length, operationId, status: "QUEUED", httpStatus: 202 } as const;
}

export async function getOperation(operationId: string, env: Env) {
  const row = await env.DB.prepare(`SELECT id,type,status,requested,succeeded,failed,created_at,updated_at,error
    FROM v2_ingest_operations WHERE id=?`).bind(operationId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    requested: Number(row.requested || 0),
    succeeded: Number(row.succeeded || 0),
    failed: Number(row.failed || 0),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    error: row.error || null,
  };
}

export async function listCandidates(request: Request, env: Env) {
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "MATERIALIZED").trim();
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 200));
  const result = await env.DB.prepare(`SELECT * FROM v2_ingest_candidates WHERE status=? ORDER BY updated_at DESC LIMIT ?`).bind(status, limit).all<Record<string, unknown>>();
  return Promise.all((result.results || []).map(async row => ({
    id: row.id,
    operationId: row.operation_id,
    sourceUrl: row.source_url,
    projectId: row.project_id,
    itemId: row.item_id,
    universe: row.universe,
    subject: row.subject,
    tags: JSON.parse(String(row.tags_json || "[]")),
    status: row.status,
    r2Key: row.r2_key,
    previewUrl: row.r2_key ? await createSignedCandidateUrl(request, String(row.id), env) : null,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    failureReason: row.failure_reason || null,
    attempts: Number(row.attempts || 0),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  })));
}

export async function approveCandidate(candidateId: string, env: Env) {
  const candidate = await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string, unknown>>();
  if (!candidate) return { error: "NOT_FOUND", status: 404 } as const;
  if (candidate.status !== "MATERIALIZED") return { error: "INVALID_STATE", currentStatus: candidate.status, status: 409 } as const;

  const sourceKey = String(candidate.r2_key || "");
  const sourceObject = sourceKey ? await env.MEDIA.get(sourceKey) : null;
  if (!sourceObject) return { error: "OBJECT_MISSING", status: 409 } as const;

  const assetId = id("AST");
  const mime = String(candidate.mime_type || "application/octet-stream");
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
  const rawName = safeFilenameFromUrl(String(candidate.source_url || ""), `${candidateId}.${ext}`);
  const filename = rawName.includes(".") ? rawName : `${rawName}.${ext}`;
  const finalKey = `assets/${assetId}/${filename}`;
  await env.MEDIA.put(finalKey, sourceObject.body, {
    httpMetadata: sourceObject.httpMetadata,
    customMetadata: { ...(sourceObject.customMetadata || {}), approvedFromCandidate: candidateId, assetId },
  });

  const timestamp = nowMs();
  const subject = String(candidate.subject || "").trim();
  const universe = String(candidate.universe || "").trim() || "Sem universo";
  const tags = String(candidate.tags_json || "[]");
  const name = subject || filename.replace(/\.[^.]+$/, "");
  const sizeBytes = Number(candidate.size_bytes || sourceObject.size || 0);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO assets
      (id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,use_count,created_at,updated_at,subject,source_url,qa_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        assetId, name, universe, "Imagem", "Aprovado", tags, finalKey, filename, mime, sizeBytes, 0, timestamp, timestamp, subject || null, candidate.source_url || null, "APROVADO",
      ),
    env.DB.prepare("UPDATE v2_ingest_candidates SET status='APPROVED',asset_id=?,updated_at=? WHERE id=?").bind(assetId, timestamp, candidateId),
  ]);
  await env.MEDIA.delete(sourceKey);
  return { ok: true, assetId, r2Key: finalKey, status: 200 } as const;
}

export async function rejectCandidate(candidateId: string, env: Env) {
  const candidate = await env.DB.prepare("SELECT status,r2_key FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<{ status: string; r2_key: string | null }>();
  if (!candidate) return { error: "NOT_FOUND", status: 404 } as const;
  if (["APPROVED", "REJECTED"].includes(candidate.status)) return { error: "INVALID_STATE", currentStatus: candidate.status, status: 409 } as const;
  if (candidate.r2_key) await env.MEDIA.delete(candidate.r2_key).catch(() => undefined);
  await env.DB.prepare("UPDATE v2_ingest_candidates SET status='REJECTED',updated_at=? WHERE id=?").bind(nowMs(), candidateId).run();
  return { ok: true, status: 200 } as const;
}

export async function materialize(message: Message<MaterializeJob>, env: Env) {
  const job = message.body;
  const started = nowMs();
  const state = await env.DB.prepare("SELECT attempts FROM v2_ingest_candidates WHERE id=?").bind(job.candidateId).first<{ attempts: number }>();
  const attempt = Number(state?.attempts || 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=? AND status='QUEUED'").bind(started, job.operationId),
    env.DB.prepare("UPDATE v2_ingest_candidates SET status='DOWNLOADING',attempts=?,updated_at=? WHERE id=?").bind(attempt, started, job.candidateId),
  ]);

  let shouldRetry = false;
  try {
    const remote = safeRemoteUrl(job.url);
    if (!remote) throw new Error("UNSAFE_URL");
    const response = await fetch(remote.toString(), { redirect: "follow", headers: { "user-agent": "CorvoLibraryV2/1.0" } });
    if (!response.ok || !response.body) {
      shouldRetry = transientHttpStatus(response.status);
      throw new Error(`HTTP_${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 30 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
    const mime = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/") && !mime.startsWith("video/")) throw new Error(`INVALID_MIME_${mime}`);
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
    const r2Key = `incoming/${job.operationId}/${job.candidateId}.${ext}`;
    await env.MEDIA.put(r2Key, limitedStream(response.body, 30 * 1024 * 1024), {
      httpMetadata: { contentType: mime },
      customMetadata: { sourceUrl: job.url, operationId: job.operationId, candidateId: job.candidateId },
    });
    const stored = await env.MEDIA.head(r2Key);
    const done = nowMs();
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_ingest_candidates SET status='MATERIALIZED',r2_key=?,mime_type=?,size_bytes=?,failure_reason=NULL,updated_at=? WHERE id=?").bind(r2Key, mime, Number(stored?.size || contentLength || 0), done, job.candidateId),
      env.DB.prepare("UPDATE v2_ingest_operations SET succeeded=succeeded+1,updated_at=? WHERE id=?").bind(done, job.operationId),
    ]);
  } catch (error) {
    const done = nowMs();
    const reason = error instanceof Error ? error.message.slice(0, 240) : "MATERIALIZATION_FAILED";
    if ((shouldRetry || error instanceof TypeError) && attempt < 5) {
      await env.DB.prepare("UPDATE v2_ingest_candidates SET status='RETRYING',failure_reason=?,updated_at=? WHERE id=?").bind(reason, done, job.candidateId).run();
      message.retry({ delaySeconds: Math.min(60, attempt * 5) });
      return;
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_ingest_candidates SET status='FAILED',failure_reason=?,updated_at=? WHERE id=?").bind(reason, done, job.candidateId),
      env.DB.prepare("UPDATE v2_ingest_operations SET failed=failed+1,updated_at=? WHERE id=?").bind(done, job.operationId),
    ]);
  }

  const totals = await env.DB.prepare("SELECT requested,succeeded,failed FROM v2_ingest_operations WHERE id=?").bind(job.operationId).first<{ requested: number; succeeded: number; failed: number }>();
  if (totals && totals.succeeded + totals.failed >= totals.requested) {
    const finalStatus = totals.failed === 0 ? "COMPLETED" : totals.succeeded > 0 ? "COMPLETED_WITH_ERRORS" : "FAILED";
    await env.DB.prepare("UPDATE v2_ingest_operations SET status=?,updated_at=? WHERE id=?").bind(finalStatus, nowMs(), job.operationId).run();
  }
  message.ack();
}
