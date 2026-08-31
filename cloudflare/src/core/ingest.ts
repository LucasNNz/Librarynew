import type { CorvoQueueJob, Env, FastPushBody, MaterializeJob } from "../types";
import { id, nowMs, safeFilenameFromUrl, stableId } from "./ids";
import { limitedStream, safeRemoteUrl, transientHttpStatus } from "./net";
import { createSignedCandidateUrl } from "./auth";
import { recordIngestEvent, updateHostHealth } from "./materialization";
import { createProjectMediaFromCandidate } from "./production";
import { setProjectProfileFromCandidate } from "./project-profile";
import { refreshProjectItemPipelineState, summarizeOperationCollectionGoal } from "./project-pipeline-state";
import { projectWriteGuard } from "./project-workflow";
import { refreshRecoveryAfterWrite, writeAssetRecoveryRecord, writeCandidateRecoveryRecord } from "./recovery-manifest";

function normalizeTags(tags: unknown) {
  return Array.isArray(tags) ? [...new Set(tags.map(String).map(value => value.trim()).filter(Boolean))].slice(0, 40) : [];
}

async function touchProjectArtifactState(env:Env,projectId:unknown){
  const value=String(projectId??"").trim();
  if(!value)return;
  const ts=nowMs();
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,value).run().catch(()=>undefined);
}

async function refreshTouchedItems(env: Env, rows: Array<{projectId?:string;itemId?:string}>) {
  const keys = [...new Set(rows.map(row => `${row.projectId || ""}\n${row.itemId || ""}`).filter(key => !key.startsWith("\n") && !key.endsWith("\n")))];
  for (const key of keys) {
    const [projectId, itemId] = key.split("\n");
    await refreshProjectItemPipelineState(env, projectId, itemId).catch(() => undefined);
  }
}

export async function activateProjectItemCandidateReserve(env: Env, input: { projectId?: string | null; itemId?: string | null; operationId: string }) {
  const projectId = String(input.projectId || "").trim();
  const itemRef = String(input.itemId || "").trim();
  const operationId = String(input.operationId || "").trim();
  if (!projectId || !itemRef || !operationId) return { activated: 0, reserve: 0, reason: "PROJECT_ITEM_OPERATION_REQUIRED" } as const;

  const item = await env.DB.prepare(`SELECT id,item_key,target_candidates FROM automatic_project_items
    WHERE project_id=? AND (id=? OR item_key=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(projectId, itemRef, itemRef, itemRef).first<{id:string;item_key:string|null;target_candidates:number}>();
  if (!item) return { activated: 0, reserve: 0, reason: "ITEM_NOT_FOUND" } as const;

  const itemId = String(item.id), itemKey = String(item.item_key || item.id);
  const target = Math.max(1, Number(item.target_candidates || 8));
  const counts = await env.DB.prepare(`SELECT
      SUM(CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN 1 ELSE 0 END) AS materialized,
      SUM(CASE WHEN status IN ('QUEUED','DOWNLOADING','RETRYING') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='DISCOVERED' THEN 1 ELSE 0 END) AS reserve
    FROM v2_ingest_candidates WHERE project_id=? AND item_id IN (?,?)`)
    .bind(projectId, itemId, itemKey).first<{materialized:number;active:number;reserve:number}>();
  const materialized = Number(counts?.materialized || 0);
  const active = Number(counts?.active || 0);
  const reserve = Number(counts?.reserve || 0);
  const slots = Math.max(0, target - materialized - active);
  if (!slots || !reserve) {
    await refreshProjectItemPipelineState(env, projectId, itemId).catch(() => undefined);
    return { activated: 0, reserve, target, materialized, active } as const;
  }

  const candidates = await env.DB.prepare(`SELECT id,operation_id,source_url,project_id,item_id,universe,subject,tags_json
    FROM v2_ingest_candidates WHERE project_id=? AND item_id IN (?,?) AND status='DISCOVERED'
    ORDER BY CASE WHEN operation_id=? THEN 0 ELSE 1 END,created_at ASC,id ASC LIMIT ?`)
    .bind(projectId, itemId, itemKey, operationId, slots).all<Record<string,unknown>>();
  const claimed: Record<string,unknown>[] = [];
  const queuedAt = nowMs();
  for (const candidate of candidates.results || []) {
    const result = await env.DB.prepare(`UPDATE v2_ingest_candidates SET status='QUEUED',queued_at=?,updated_at=?
      WHERE id=? AND status='DISCOVERED'`).bind(queuedAt, queuedAt, candidate.id).run();
    if (Number(result.meta?.changes || 0) > 0) claimed.push(candidate);
  }
  if (!claimed.length) return { activated: 0, reserve, target, materialized, active } as const;

  const claimedByOperation = new Map<string,number>();
  for (const candidate of claimed) claimedByOperation.set(String(candidate.operation_id), (claimedByOperation.get(String(candidate.operation_id)) || 0) + 1);
  for (const [candidateOperationId,count] of claimedByOperation) {
    await env.DB.prepare(`UPDATE v2_ingest_operations SET requested=requested+?,status=CASE WHEN status IN ('COMPLETED','COMPLETED_WITH_ERRORS','FAILED') THEN 'QUEUED' ELSE status END,updated_at=? WHERE id=?`)
      .bind(count, queuedAt, candidateOperationId).run();
  }
  const jobs: MessageSendRequest<CorvoQueueJob>[] = claimed.map(candidate => ({ body: {
    kind: "MATERIALIZE_URL",
    operationId: String(candidate.operation_id),
    candidateId: String(candidate.id),
    url: String(candidate.source_url),
    projectId: String(candidate.project_id || projectId),
    itemId: String(candidate.item_id || itemId),
    universe: String(candidate.universe || ""),
    subject: String(candidate.subject || ""),
    tags: (() => { try { return JSON.parse(String(candidate.tags_json || "[]")); } catch { return []; } })(),
  } }));
  try {
    for (let offset = 0; offset < jobs.length; offset += 100) await env.MATERIALIZE_QUEUE.sendBatch(jobs.slice(offset, offset + 100));
  } catch (error) {
    for (const candidate of claimed) await env.DB.prepare("UPDATE v2_ingest_candidates SET status='DISCOVERED',queued_at=NULL,updated_at=? WHERE id=? AND status='QUEUED'").bind(nowMs(), candidate.id).run().catch(()=>undefined);
    for (const [candidateOperationId,count] of claimedByOperation) await env.DB.prepare("UPDATE v2_ingest_operations SET requested=MAX(0,requested-?),updated_at=? WHERE id=?").bind(count,nowMs(),candidateOperationId).run().catch(()=>undefined);
    throw error;
  }
  await recordIngestEvent(env, operationId, null, "RESERVE_ACTIVATED", "QUEUED", JSON.stringify({projectId,itemId,activated:claimed.length,target,materialized,active,byOperation:Object.fromEntries(claimedByOperation)}), null);
  await refreshProjectItemPipelineState(env, projectId, itemId).catch(() => undefined);
  return { activated: claimed.length, reserve: Math.max(0,reserve-claimed.length), target, materialized, active: active+claimed.length } as const;
}

export async function enqueueFastPushItems(env: Env, items: NonNullable<FastPushBody["urls"]>, input:{operationId?:string;type?:string}={}) {
  const rows = Array.isArray(items) ? items.filter(item => typeof item?.url === "string" && safeRemoteUrl(item.url) !== null).slice(0, 500) : [];
  if (!rows.length) return { error: "NO_VALID_URLS", status: 400 } as const;

  const operationId = input.operationId || id("OP");
  const existing = await env.DB.prepare("SELECT id,status,requested FROM v2_ingest_operations WHERE id=?").bind(operationId).first<{id:string;status:string;requested:number}>();
  if (existing) return { accepted: Number(existing.requested || 0), operationId, status: existing.status, httpStatus: 202, idempotent: true } as const;

  const created = nowMs();
  await env.DB.prepare(`INSERT INTO v2_ingest_operations
    (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(operationId, input.type || "FAST_PUSH", "QUEUED", rows.length, 0, 0, "{}", created, created).run();

  const jobs: MessageSendRequest<CorvoQueueJob>[] = [];
  const inserts: D1PreparedStatement[] = [];
  for (const row of rows) {
    const candidateId = id("CAND");
    const tags = normalizeTags(row.tags);
    inserts.push(env.DB.prepare(`INSERT INTO v2_ingest_candidates
      (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,created_at,updated_at,discovered_at,queued_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
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
        created,
        created,
      ));
    jobs.push({ body: { kind: "MATERIALIZE_URL", operationId, candidateId, url: row.url!, projectId: row.projectId, itemId: row.itemId, universe: row.universe, subject: row.subject, tags } });
  }

  for (let offset = 0; offset < inserts.length; offset += 100) await env.DB.batch(inserts.slice(offset, offset + 100));
  for (let offset = 0; offset < jobs.length; offset += 100) await env.MATERIALIZE_QUEUE.sendBatch(jobs.slice(offset, offset + 100));
  await refreshTouchedItems(env, rows);
  await recordIngestEvent(env, operationId, null, "FAST_PUSH_ACCEPTED", "QUEUED", `${rows.length} URL(s) accepted`, null);
  return { accepted: rows.length, operationId, status: "QUEUED", httpStatus: 202 } as const;
}

export async function fastPush(request: Request, env: Env) {
  const body = await request.json().catch(() => ({})) as FastPushBody;
  return enqueueFastPushItems(env, body.urls || []);
}

export async function getOperation(operationId: string, env: Env) {
  const row = await env.DB.prepare(`SELECT id,type,status,requested,succeeded,failed,created_at,updated_at,error
    FROM v2_ingest_operations WHERE id=?`).bind(operationId).first<Record<string, unknown>>();
  if (!row) return null;
  const goal = await summarizeOperationCollectionGoal(env, operationId);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    goalSatisfied: goal.goalSatisfied,
    goal_satisfied: goal.goalSatisfied,
    collectionStatus: goal.collectionStatus,
    collection_status: goal.collectionStatus,
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
    previewUrl: row.r2_key && row.status === "MATERIALIZED" ? await createSignedCandidateUrl(request, String(row.id), env) : null,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    failureReason: row.failure_reason || null,
    attempts: Number(row.attempts || 0),
    telemetry: {
      queueWaitMs: Number(row.queue_wait_ms || 0),
      downloadMs: Number(row.download_ms || 0),
      r2WriteMs: Number(row.r2_write_ms || 0),
      d1FinalizeMs: Number(row.d1_finalize_ms || 0),
      totalMaterializationMs: Number(row.total_materialization_ms || 0),
    },
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  })));
}

async function deleteIncomingObject(env: Env, key: string) {
  if (!key || !key.startsWith("incoming/")) return false;
  try { await env.MEDIA.delete(key); return true; } catch { return false; }
}

export async function approveCandidate(candidateId: string, env: Env) {
  const candidate = await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string, unknown>>();
  if (!candidate) return { error: "NOT_FOUND", status: 404 } as const;
  if(candidate.project_id){const guard=await projectWriteGuard(env,String(candidate.project_id));if(!guard.ok)return guard;}
  if (candidate.status === "APPROVED" && candidate.asset_id) {
    const asset = await env.DB.prepare("SELECT id,r2_key FROM assets WHERE id=?").bind(candidate.asset_id).first<Record<string, unknown>>();
    if (asset) return { ok:true, assetId:String(asset.id), r2Key:String(asset.r2_key), incomingDeleted:true, idempotent:true, status:200 } as const;
  }
  if (candidate.status !== "MATERIALIZED") return { error: "INVALID_STATE", currentStatus: candidate.status, status: 409 } as const;

  const sourceKey = String(candidate.r2_key || "");
  const sourceObject = sourceKey ? await env.MEDIA.get(sourceKey) : null;
  if (!sourceObject) return { error: "OBJECT_MISSING", status: 409 } as const;

  const assetId = await stableId("AST", `V2_FAST_PUSH\n${candidateId}`, 10);
  const mime = String(candidate.mime_type || "application/octet-stream");
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
  const rawName = safeFilenameFromUrl(String(candidate.source_url || ""), `${candidateId}.${ext}`);
  const filename = rawName.includes(".") ? rawName : `${rawName}.${ext}`;
  const desiredKey = `assets/${assetId}/${filename}`;

  const existing = await env.DB.prepare("SELECT id,r2_key FROM assets WHERE id=?").bind(assetId).first<Record<string, unknown>>();
  const finalKey = existing?.r2_key ? String(existing.r2_key) : desiredKey;
  if (!existing) {
    const fixedBytes = new Uint8Array(await sourceObject.arrayBuffer());
    await env.MEDIA.put(finalKey, fixedBytes, {
      httpMetadata: sourceObject.httpMetadata,
      customMetadata: { ...(sourceObject.customMetadata || {}), approvedFromCandidate: candidateId, assetId },
    });
  }

  const timestamp = nowMs();
  const subject = String(candidate.subject || "").trim();
  const universe = String(candidate.universe || "").trim() || "Sem universo";
  const tags = String(candidate.tags_json || "[]");
  const name = subject || filename.replace(/\.[^.]+$/, "");
  const sizeBytes = Number(candidate.size_bytes || sourceObject.size || 0);

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO assets
      (id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,use_count,created_at,updated_at,subject,source_url,qa_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        assetId, name, universe, "Imagem", "Aprovado", tags, finalKey, filename, mime, sizeBytes, 0, timestamp, timestamp, subject || null, candidate.source_url || null, "APROVADO",
      ),
    env.DB.prepare("UPDATE v2_ingest_candidates SET status='APPROVED',asset_id=?,r2_key=?,updated_at=? WHERE id=? AND status IN ('MATERIALIZED','APPROVED')").bind(assetId, finalKey, timestamp, candidateId),
  ]);
  await writeAssetRecoveryRecord(env,assetId,"FAST_PUSH_APPROVED").catch(() => undefined);
  await writeCandidateRecoveryRecord(env,candidateId,"CANDIDATE_APPROVED").catch(() => undefined);
  await refreshRecoveryAfterWrite(env,"FAST_PUSH_APPROVED",assetId);
  const incomingDeleted = sourceKey !== finalKey ? await deleteIncomingObject(env, sourceKey) : false;
  await refreshProjectItemPipelineState(env, String(candidate.project_id || ""), String(candidate.item_id || "")).catch(() => undefined);
  await touchProjectArtifactState(env,candidate.project_id);
  await recordIngestEvent(env, String(candidate.operation_id), candidateId, "CANDIDATE_APPROVED", "APPROVED", JSON.stringify({assetId,incomingDeleted}), null);
  return { ok: true, assetId, r2Key: finalKey, incomingDeleted, status: 200 } as const;
}

export async function rejectCandidate(candidateId: string, env: Env) {
  const candidate = await env.DB.prepare("SELECT status,r2_key,operation_id,project_id,item_id FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<{ status: string; r2_key: string | null; operation_id:string; project_id:string|null; item_id:string|null }>();
  if (!candidate) return { error: "NOT_FOUND", status: 404 } as const;
  if(candidate.project_id){const guard=await projectWriteGuard(env,String(candidate.project_id));if(!guard.ok)return guard;}
  if (candidate.status === "APPROVED") return { error: "INVALID_STATE", currentStatus: candidate.status, status: 409 } as const;
  if (candidate.status === "REJECTED") return { ok:true, status:200, incomingDeleted:!candidate.r2_key, idempotent:true } as const;
  const incomingDeleted = candidate.r2_key ? await deleteIncomingObject(env, candidate.r2_key) : false;
  await env.DB.prepare("UPDATE v2_ingest_candidates SET status='REJECTED',r2_key=NULL,updated_at=? WHERE id=?").bind(nowMs(), candidateId).run();
  await writeCandidateRecoveryRecord(env,candidateId,"CANDIDATE_REJECTED").catch(() => undefined);
  await refreshProjectItemPipelineState(env, candidate.project_id, candidate.item_id).catch(() => undefined);
  await touchProjectArtifactState(env,candidate.project_id);
  await recordIngestEvent(env, candidate.operation_id, candidateId, "CANDIDATE_REJECTED", "REJECTED", JSON.stringify({incomingDeleted}), null);
  return { ok: true, incomingDeleted, status: 200 } as const;
}

export async function materialize(message: Message<MaterializeJob>, env: Env) {
  const job = message.body;
  const started = nowMs();
  const state = await env.DB.prepare("SELECT attempts,status,queued_at,created_at,project_id,item_id FROM v2_ingest_candidates WHERE id=?").bind(job.candidateId).first<{ attempts: number; status:string; queued_at:number|null; created_at:number; project_id:string|null; item_id:string|null }>();
  if (!state) { message.ack(); return; }
  if (["APPROVED","REJECTED","MATERIALIZED"].includes(String(state.status || "").toUpperCase())) { message.ack(); return; }
  const materializeProjectId=String(job.projectId||state.project_id||"").trim();
  if(materializeProjectId){const guard=await projectWriteGuard(env,materializeProjectId);if(!guard.ok){await env.DB.prepare("UPDATE v2_ingest_candidates SET status='FAILED',failure_reason='PROJECT_LOCKED',updated_at=? WHERE id=? AND status IN ('QUEUED','RETRYING')").bind(nowMs(),job.candidateId).run().catch(()=>undefined);message.ack();return;}}
  const attempt = Number(state.attempts || 0) + 1;
  const queuedAt = Number(state.queued_at || state.created_at || started);
  const queueWaitMs = Math.max(0, started - queuedAt);
  const claim = await env.DB.prepare(`UPDATE v2_ingest_candidates SET status='DOWNLOADING',attempts=?,download_started_at=?,queue_wait_ms=COALESCE(queue_wait_ms,?),updated_at=?
    WHERE id=? AND status IN ('QUEUED','RETRYING')`).bind(attempt, started, queueWaitMs, started, job.candidateId).run();
  if (Number(claim.meta?.changes || 0) === 0) { message.ack(); return; }
  await env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=? AND status IN ('QUEUED','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')").bind(started, job.operationId).run();
  await refreshProjectItemPipelineState(env, job.projectId || state.project_id, job.itemId || state.item_id).catch(() => undefined);
  await recordIngestEvent(env, job.operationId, job.candidateId, "DOWNLOAD_STARTED", "DOWNLOADING", JSON.stringify({attempt,queueWaitMs}), null);

  let shouldRetry = false;
  try {
    const remote = safeRemoteUrl(job.url);
    if (!remote) throw new Error("UNSAFE_URL");
    const response = await fetch(remote.toString(), { redirect: "follow", headers: { "user-agent": "CorvoLibraryV2/1.0" }, signal: AbortSignal.timeout(25_000) });
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
    const maxRemoteBytes = 30 * 1024 * 1024;
    const remoteBytes = new Uint8Array(await new Response(limitedStream(response.body, maxRemoteBytes)).arrayBuffer());
    if (remoteBytes.byteLength > maxRemoteBytes) throw new Error("FILE_TOO_LARGE");
    const downloadDone = nowMs();
    const downloadMs = Math.max(0, downloadDone - started);

    const r2Started = nowMs();
    await env.MEDIA.put(r2Key, remoteBytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { sourceUrl: job.url, operationId: job.operationId, candidateId: job.candidateId },
    });
    const stored = await env.MEDIA.head(r2Key);
    const r2Done = nowMs();
    const r2WriteMs = Math.max(0, r2Done - r2Started);

    const d1Started = nowMs();
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_ingest_candidates SET status='MATERIALIZED',r2_key=?,mime_type=?,size_bytes=?,failure_reason=NULL,materialized_at=?,download_ms=?,r2_write_ms=?,updated_at=? WHERE id=?")
        .bind(r2Key, mime, Number(stored?.size || remoteBytes.byteLength || contentLength || 0), d1Started, downloadMs, r2WriteMs, d1Started, job.candidateId),
      env.DB.prepare("UPDATE v2_ingest_operations SET succeeded=succeeded+1,updated_at=? WHERE id=?").bind(d1Started, job.operationId),
    ]);
    const d1Done = nowMs();
    const d1FinalizeMs = Math.max(0, d1Done - d1Started);
    const totalMaterializationMs = Math.max(0, d1Done - queuedAt);
    await env.DB.prepare("UPDATE v2_ingest_candidates SET d1_finalize_ms=?,total_materialization_ms=?,updated_at=? WHERE id=?")
      .bind(d1FinalizeMs,totalMaterializationMs,d1Done,job.candidateId).run();

    await writeCandidateRecoveryRecord(env,job.candidateId,"CANDIDATE_MATERIALIZED").catch(() => undefined);
    await refreshRecoveryAfterWrite(env,"IMAGE_MATERIALIZED",job.candidateId);
    await updateHostHealth(env, remote.hostname.toLowerCase(), true);
    const normalizedJobTags=(job.tags || []).map(tag=>String(tag).toLowerCase());
    if (job.projectId && normalizedJobTags.includes("project-profile")) {
      await setProjectProfileFromCandidate(env,{candidateId:job.candidateId,projectId:job.projectId,origin:"FAST_PUSH_PROJECT_PROFILE"}).catch(()=>undefined);
    } else if (job.projectId && normalizedJobTags.includes("thumb")) {
      await createProjectMediaFromCandidate(env,{candidateId:job.candidateId,projectId:job.projectId,r2Key,mimeType:mime,sizeBytes:Number(stored?.size || remoteBytes.byteLength || contentLength || 0),sourceUrl:job.url,agentOrigin:"FAST_PUSH"}).catch(()=>undefined);
    }
    const projectId = job.projectId || state.project_id, itemId = job.itemId || state.item_id;
    await refreshProjectItemPipelineState(env, projectId, itemId).catch(() => undefined);
    await touchProjectArtifactState(env,projectId);
    const replenishment = await activateProjectItemCandidateReserve(env,{projectId,itemId,operationId:job.operationId}).catch(()=>({activated:0}));
    await recordIngestEvent(env, job.operationId, job.candidateId, "MATERIALIZED", "MATERIALIZED", JSON.stringify({r2Key,queueWaitMs,downloadMs,r2WriteMs,d1FinalizeMs,totalMaterializationMs,replacementActivated:Number(replenishment.activated||0)}), totalMaterializationMs);
  } catch (error) {
    const done = nowMs();
    const reason = error instanceof Error ? error.message.slice(0, 240) : "MATERIALIZATION_FAILED";
    const failedRemote = safeRemoteUrl(job.url);
    if (failedRemote) await updateHostHealth(env, failedRemote.hostname.toLowerCase(), false);
    const totalMaterializationMs = Math.max(0, done - queuedAt);
    const attemptDurationMs = Math.max(0, done - started);
    if ((shouldRetry || error instanceof TypeError || reason.includes("Timeout") || reason.includes("timed out")) && attempt < 5) {
      await env.DB.prepare("UPDATE v2_ingest_candidates SET status='RETRYING',failure_reason=?,download_ms=?,total_materialization_ms=?,updated_at=? WHERE id=?")
        .bind(reason,attemptDurationMs,totalMaterializationMs,done,job.candidateId).run();
      await refreshProjectItemPipelineState(env, job.projectId || state.project_id, job.itemId || state.item_id).catch(() => undefined);
      await recordIngestEvent(env, job.operationId, job.candidateId, "RETRY_SCHEDULED", "RETRYING", JSON.stringify({reason,attempt,delaySeconds:Math.min(15,attempt*2)}), attemptDurationMs);
      message.retry({ delaySeconds: Math.min(15, attempt * 2) });
      return;
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_ingest_candidates SET status='FAILED',failure_reason=?,download_ms=?,total_materialization_ms=?,updated_at=? WHERE id=?").bind(reason,attemptDurationMs,totalMaterializationMs,done,job.candidateId),
      env.DB.prepare("UPDATE v2_ingest_operations SET failed=failed+1,updated_at=? WHERE id=?").bind(done, job.operationId),
    ]);
    const projectId = job.projectId || state.project_id, itemId = job.itemId || state.item_id;
    await refreshProjectItemPipelineState(env, projectId, itemId).catch(() => undefined);
    const replenishment = await activateProjectItemCandidateReserve(env,{projectId,itemId,operationId:job.operationId}).catch(()=>({activated:0}));
    const invalidSource = /^HTTP_(400|403|404)$/.test(reason);
    await recordIngestEvent(env, job.operationId, job.candidateId, invalidSource ? "INVALID_SOURCE_FAILED" : "MATERIALIZATION_FAILED", "FAILED", JSON.stringify({reason,queueWaitMs,totalMaterializationMs,replacementActivated:Number(replenishment.activated||0),retryable:false}), totalMaterializationMs);
  }

  const totals = await env.DB.prepare("SELECT requested,succeeded,failed FROM v2_ingest_operations WHERE id=?").bind(job.operationId).first<{ requested: number; succeeded: number; failed: number }>();
  if (totals && totals.succeeded + totals.failed >= totals.requested) {
    const finalStatus = totals.failed === 0 ? "COMPLETED" : totals.succeeded > 0 ? "COMPLETED_WITH_ERRORS" : "FAILED";
    const goal = await summarizeOperationCollectionGoal(env, job.operationId);
    await env.DB.prepare(`UPDATE v2_ingest_operations SET status=?,
      payload_json=json_set(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.goal_satisfied',?,'$.collection_status',?),updated_at=? WHERE id=?`)
      .bind(finalStatus,goal.goalSatisfied?1:0,goal.collectionStatus,nowMs(),job.operationId).run();
  }
  message.ack();
}

export async function linkCandidatesToProject(env:Env,candidateIds:string[],projectId:string,itemId?:string|null){
  const guard=await projectWriteGuard(env,projectId); if(!guard.ok)return guard;
  const ids=[...new Set(candidateIds.map(String).filter(Boolean))].slice(0,200); if(!ids.length)return {updated:0};
  const ts=nowMs(); let updated=0;
  for(const candidateId of ids){ const result=await env.DB.prepare("UPDATE v2_ingest_candidates SET project_id=?,item_id=COALESCE(?,item_id),updated_at=? WHERE id=?").bind(projectId,itemId||null,ts,candidateId).run(); updated+=Number(result.meta?.changes||0); }
  if(itemId)await refreshProjectItemPipelineState(env,projectId,itemId).catch(()=>undefined);
  return {updated,projectId,itemId:itemId||null};
}

export async function deleteIngestCandidates(env:Env,candidateIds:string[]){
  const ids=[...new Set(candidateIds.map(String).filter(Boolean))].slice(0,200); const results=[] as Array<Record<string,unknown>>;
  for(const candidateId of ids){
    const row=await env.DB.prepare("SELECT status,r2_key,project_id,item_id FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<{status:string;r2_key:string|null;project_id:string|null;item_id:string|null}>();
    if(!row){results.push({candidateId,error:"NOT_FOUND"});continue;}
    if(row.status==="APPROVED"){results.push({candidateId,error:"APPROVED_IMMUTABLE"});continue;}
    if(row.r2_key&&row.r2_key.startsWith("incoming/"))await env.MEDIA.delete(row.r2_key).catch(()=>undefined);
    await env.DB.prepare("DELETE FROM v2_ingest_candidates WHERE id=?").bind(candidateId).run();
    await refreshProjectItemPipelineState(env,row.project_id,row.item_id).catch(()=>undefined);
    results.push({candidateId,deleted:true});
  }
  return {results,deleted:results.filter(item=>item.deleted===true).length};
}
