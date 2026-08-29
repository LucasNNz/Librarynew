import type { Env, MaterializeJob } from "../types";
import { id, nowMs } from "./ids";
import { safeRemoteUrl } from "./net";

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordIngestEvent(env: Env, operationId: string, candidateId: string | null, event: string, status?: string | null, detail?: string | null, durationMs?: number | null) {
  await env.DB.prepare(`INSERT INTO v2_ingest_events (id,operation_id,candidate_id,event,status,detail,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id("EVT"), operationId, candidateId, event, status || null, detail || null, durationMs ?? null, nowMs()).run();
}

export async function updateHostHealth(env: Env, host: string, success: boolean) {
  if (!host) return;
  const ts = nowMs();
  const current = await env.DB.prepare("SELECT * FROM materialization_host_health WHERE host=?").bind(host).first<Record<string, unknown>>();
  const successes = Number(current?.success_count || 0) + (success ? 1 : 0);
  const failures = Number(current?.failure_count || 0) + (success ? 0 : 1);
  const recentFailures = success ? 0 : Number(current?.recent_failure_count || 0) + 1;
  const circuit = recentFailures >= 5 ? "OPEN" : "CLOSED";
  const blockedUntil = circuit === "OPEN" ? ts + 5 * 60_000 : null;
  if (current) {
    await env.DB.prepare("UPDATE materialization_host_health SET success_count=?,failure_count=?,recent_failure_count=?,circuit_state=?,blocked_until=?,updated_at=? WHERE host=?")
      .bind(successes, failures, recentFailures, circuit, blockedUntil, ts, host).run();
  } else {
    await env.DB.prepare("INSERT INTO materialization_host_health (host,success_count,failure_count,recent_failure_count,circuit_state,blocked_until,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(host, successes, failures, recentFailures, circuit, blockedUntil, ts).run();
  }
}

export async function retryIngestCandidate(candidateId: string, env: Env) {
  const candidate = await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string, unknown>>();
  if (!candidate) return { error: "NOT_FOUND", status: 404 } as const;
  if (candidate.status !== "FAILED") return { error: "INVALID_STATE", currentStatus: candidate.status, status: 409 } as const;
  const operationId = String(candidate.operation_id);
  const ts = nowMs();
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_ingest_candidates SET status='QUEUED',failure_reason=NULL,updated_at=? WHERE id=?").bind(ts, candidateId),
    env.DB.prepare("UPDATE v2_ingest_operations SET failed=CASE WHEN failed>0 THEN failed-1 ELSE 0 END,status='PROCESSING',updated_at=? WHERE id=?").bind(ts, operationId),
  ]);
  const tags = (() => { try { return JSON.parse(String(candidate.tags_json || "[]")); } catch { return []; } })();
  const body: MaterializeJob = {
    operationId,
    candidateId,
    url: String(candidate.source_url),
    projectId: candidate.project_id ? String(candidate.project_id) : undefined,
    itemId: candidate.item_id ? String(candidate.item_id) : undefined,
    universe: candidate.universe ? String(candidate.universe) : undefined,
    subject: candidate.subject ? String(candidate.subject) : undefined,
    tags: Array.isArray(tags) ? tags.map(String) : [],
  };
  await env.MATERIALIZE_QUEUE.send(body);
  await recordIngestEvent(env, operationId, candidateId, "MANUAL_RETRY", "QUEUED", null, null);
  return { ok: true, candidateId, operationId, status: 202 } as const;
}

export async function getMaterializationStats(env: Env) {
  const [candidates, operations, hosts] = await env.DB.batch([
    env.DB.prepare(`SELECT status,COUNT(*) AS count,SUM(size_bytes) AS bytes,AVG(attempts) AS avg_attempts FROM v2_ingest_candidates GROUP BY status`),
    env.DB.prepare(`SELECT status,COUNT(*) AS count,SUM(requested) AS requested,SUM(succeeded) AS succeeded,SUM(failed) AS failed FROM v2_ingest_operations GROUP BY status`),
    env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN circuit_state='OPEN' THEN 1 ELSE 0 END) AS open_circuits,SUM(success_count) AS successes,SUM(failure_count) AS failures FROM materialization_host_health`),
  ]);
  return { candidateStates: candidates.results || [], operationStates: operations.results || [], hostHealth: hosts.results?.[0] || { total: 0, open_circuits: 0, successes: 0, failures: 0 } };
}

export async function listHostHealth(env: Env, limit = 100) {
  const result = await env.DB.prepare("SELECT * FROM materialization_host_health ORDER BY circuit_state DESC,recent_failure_count DESC,updated_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 500))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function listIngestEvents(env: Env, input: { operationId?: string; candidateId?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(input.limit || 100, 500));
  if (input.candidateId) {
    const result = await env.DB.prepare("SELECT * FROM v2_ingest_events WHERE candidate_id=? ORDER BY created_at DESC LIMIT ?").bind(input.candidateId, limit).all<Record<string, unknown>>();
    return result.results || [];
  }
  if (input.operationId) {
    const result = await env.DB.prepare("SELECT * FROM v2_ingest_events WHERE operation_id=? ORDER BY created_at DESC LIMIT ?").bind(input.operationId, limit).all<Record<string, unknown>>();
    return result.results || [];
  }
  const result = await env.DB.prepare("SELECT * FROM v2_ingest_events ORDER BY created_at DESC LIMIT ?").bind(limit).all<Record<string, unknown>>();
  return result.results || [];
}

export async function probeRemoteUrl(env: Env, value: string, timeoutMs = 10000) {
  const url = safeRemoteUrl(value);
  if (!url) return { ok: false, error: "UNSAFE_URL" };
  const started = nowMs();
  let status = "FAILED";
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let detail: string | null = null;
  let finalUrl = url.toString();
  try {
    const response = await fetch(url.toString(), { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, 30000))), headers: { "user-agent": "CorvoLibraryV2/1.0" } });
    httpStatus = response.status;
    contentType = response.headers.get("content-type");
    finalUrl = response.url || finalUrl;
    status = response.ok ? "OK" : "HTTP_ERROR";
    detail = response.statusText || null;
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 300) : "PROBE_FAILED";
  }
  const host = new URL(finalUrl).hostname.toLowerCase();
  await env.DB.prepare("INSERT INTO materialization_host_probes (id,url_hash,url,host,status,http_status,content_type,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id("PROBE"), await sha256Hex(value), value, host, status, httpStatus, contentType, detail, nowMs()).run();
  await updateHostHealth(env, host, status === "OK");
  return { ok: status === "OK", status, httpStatus, contentType, finalUrl, host, durationMs: nowMs() - started, detail };
}

export async function findDuplicateHash(env: Env, sha256: string) {
  const normalized = sha256.trim().toLowerCase();
  const [assets, files] = await env.DB.batch([
    env.DB.prepare("SELECT id,name,universe,status,r2_key,sha256 FROM assets WHERE LOWER(sha256)=? LIMIT 50").bind(normalized),
    env.DB.prepare("SELECT id,item_db_id,r2_key,mime_type,size_bytes,sha256,final_asset_id FROM materialization_files WHERE LOWER(sha256)=? LIMIT 50").bind(normalized),
  ]);
  return { sha256: normalized, assets: assets.results || [], materializationFiles: files.results || [] };
}

export function listAdapters() {
  return [{ id: "generic", name: "Generic HTTP(S)", discovery: false, materialization: true, redirects: true, ssrfGuard: true, maxBytes: 30 * 1024 * 1024 }];
}
