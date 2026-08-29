import type { Env } from "../types";
import { id, nowMs } from "./ids";

export async function claimNextWork(env: Env, input: { workerId: string; workerType: string; workerDomain?: string; executionId?: string; leaseSeconds?: number; projectId?: string }) {
  const ts = nowMs();
  const leaseMs = Math.max(30, Math.min(input.leaseSeconds || 300, 1800)) * 1000;
  const domain = input.workerDomain || "*";
  const executionId = input.executionId || id("EXEC");
  const capacity = await env.DB.prepare(`SELECT max_workers,max_per_project,enabled FROM worker_capacity_limits
      WHERE worker_type=? AND worker_domain IN (?, '*')
      ORDER BY CASE WHEN worker_domain=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(input.workerType, domain, domain).first<{ max_workers:number; max_per_project:number; enabled:number }>();
  const maxWorkers = capacity && Number(capacity.enabled) !== 0 ? Math.max(1, Number(capacity.max_workers || 1)) : 1000;
  const maxPerProject = capacity && Number(capacity.enabled) !== 0 ? Math.max(1, Number(capacity.max_per_project || maxWorkers)) : 1000;

  const projectFilter = input.projectId ? " AND w.project_id=?" : "";
  const bind: unknown[] = [
    input.workerId, executionId, ts, ts, ts + leaseMs, ts,
    input.workerType, domain, domain, ts,
    input.workerType, domain, domain, ts, maxWorkers,
    input.workerType, ts, maxPerProject,
  ];
  if (input.projectId) bind.push(input.projectId);

  // The historical backup contains old queue rows whose parent item/project was
  // already removed. They are preserved for audit, but V2 must never lease them.
  // Capacity checks are embedded in the same UPDATE candidate selection so two
  // concurrent claimers cannot both ignore the configured limits.
  const row = await env.DB.prepare(`UPDATE worker_work_items SET status='LEASED',lease_owner_worker_id=?,lease_execution_id=?,lease_started_at=?,lease_last_seen_at=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE id=(
      SELECT w.id FROM worker_work_items w
      WHERE w.status='READY'
        AND w.worker_type=?
        AND (?='*' OR w.project_domain=? OR w.project_domain='GENERAL')
        AND w.ready_at<=?
        AND (w.item_id IS NULL OR EXISTS (SELECT 1 FROM automatic_project_items api WHERE api.id=w.item_id))
        AND (w.project_id IS NULL OR EXISTS (SELECT 1 FROM automatic_projects ap WHERE ap.id=w.project_id))
        AND (SELECT COUNT(*) FROM worker_work_items active
             WHERE active.status='LEASED' AND active.worker_type=?
               AND (?='*' OR active.project_domain=? OR active.project_domain='GENERAL')
               AND COALESCE(active.lease_expires_at,0)>=?) < ?
        AND (SELECT COUNT(*) FROM worker_work_items activep
             WHERE activep.status='LEASED' AND activep.worker_type=?
               AND activep.project_id=w.project_id
               AND COALESCE(activep.lease_expires_at,0)>=?) < ?
        ${projectFilter}
      ORDER BY w.resume_priority DESC,w.priority DESC,w.original_ready_at ASC
      LIMIT 1
    ) AND status='READY' RETURNING *`)
    .bind(...bind).first<Record<string, unknown>>();
  if (!row) {
    const active = await env.DB.prepare(`SELECT COUNT(*) AS count FROM worker_work_items WHERE status='LEASED' AND worker_type=? AND (?='*' OR project_domain=? OR project_domain='GENERAL') AND COALESCE(lease_expires_at,0)>=?`)
      .bind(input.workerType, domain, domain, ts).first<{count:number}>();
    return { claimed: false, executionId, capacity: { maxWorkers, maxPerProject, active: Number(active?.count || 0) } };
  }
  const sessionId = `${input.workerId}:${executionId}`;
  const existing = await env.DB.prepare("SELECT id FROM worker_sessions WHERE id=?").bind(sessionId).first();
  if (existing) {
    await env.DB.prepare("UPDATE worker_sessions SET status='ATIVO',current_work_item_id=?,project_id=?,stage=?,last_action='CLAIM',last_seen_at=?,updated_at=? WHERE id=?")
      .bind(row.id, row.project_id, row.stage, ts, ts, sessionId).run();
  } else {
    await env.DB.prepare("INSERT INTO worker_sessions (id,worker_id,worker_type,worker_domain,allowed_domains,execution_id,status,current_work_item_id,project_id,stage,last_action,started_at,last_seen_at,updated_at) VALUES (?,?,?,?,? ,?,'ATIVO',?,?,?,'CLAIM',?,?,?)")
      .bind(sessionId, input.workerId, input.workerType, domain, JSON.stringify([domain]), executionId, row.id, row.project_id, row.stage, ts, ts, ts).run();
  }
  await env.DB.prepare("INSERT INTO worker_events (id,worker_id,worker_type,worker_domain,execution_id,project_id,work_item_id,stage,event_type,status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,'LEASED','{}',?)")
    .bind(id("WEV"), input.workerId, input.workerType, domain, executionId, row.project_id, row.id, row.stage, "CLAIM", ts).run();
  return { claimed: true, executionId, workItem: row, capacity: { maxWorkers, maxPerProject } };
}

export async function completeWork(env: Env, input: { workItemId: string; workerId: string; result?: unknown }) {
  const ts = nowMs();
  const current = await env.DB.prepare("SELECT * FROM worker_work_items WHERE id=?").bind(input.workItemId).first<Record<string, unknown>>();
  if (!current) return { error: "NOT_FOUND", status: 404 } as const;
  if (current.status !== "LEASED" || current.lease_owner_worker_id !== input.workerId) return { error: "LEASE_MISMATCH", status: 409 } as const;
  await env.DB.batch([
    env.DB.prepare("UPDATE worker_work_items SET status='COMPLETED',last_action='COMPLETE',completed_at=?,lease_last_seen_at=?,updated_at=? WHERE id=? AND lease_owner_worker_id=?").bind(ts, ts, ts, input.workItemId, input.workerId),
    env.DB.prepare("INSERT INTO worker_events (id,worker_id,worker_type,worker_domain,execution_id,project_id,work_item_id,stage,event_type,status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,'COMPLETED',?,?)")
      .bind(id("WEV"), input.workerId, current.worker_type, current.project_domain, current.lease_execution_id, current.project_id, input.workItemId, current.stage, "COMPLETE", JSON.stringify(input.result || {}), ts),
  ]);
  return { ok: true, workItemId: input.workItemId, status: 200 } as const;
}

export async function failWork(env: Env, input: { workItemId: string; workerId: string; reason: string; retry?: boolean; delaySeconds?: number }) {
  const ts = nowMs();
  const current = await env.DB.prepare("SELECT * FROM worker_work_items WHERE id=?").bind(input.workItemId).first<Record<string, unknown>>();
  if (!current) return { error: "NOT_FOUND", status: 404 } as const;
  if (current.status !== "LEASED" || current.lease_owner_worker_id !== input.workerId) return { error: "LEASE_MISMATCH", status: 409 } as const;
  const retry = input.retry !== false && Number(current.attempts || 0) < 3;
  const nextStatus = retry ? "READY" : "FAILED";
  const readyAt = retry ? ts + Math.max(0, Math.min(input.delaySeconds || 5, 3600)) * 1000 : Number(current.ready_at || ts);
  await env.DB.batch([
    env.DB.prepare("UPDATE worker_work_items SET status=?,ready_at=?,last_action=?,lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner_worker_id=?")
      .bind(nextStatus, readyAt, `FAIL:${input.reason.slice(0,120)}`, ts, input.workItemId, input.workerId),
    env.DB.prepare("INSERT INTO worker_events (id,worker_id,worker_type,worker_domain,execution_id,project_id,work_item_id,stage,event_type,status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id("WEV"), input.workerId, current.worker_type, current.project_domain, current.lease_execution_id, current.project_id, input.workItemId, current.stage, "FAIL", nextStatus, JSON.stringify({ reason: input.reason, retry }), ts),
  ]);
  return { ok: true, workItemId: input.workItemId, status: nextStatus, retryAt: retry ? readyAt : null };
}

export async function workerWatchdog(env: Env) {
  const ts = nowMs();
  const expired = await env.DB.prepare("SELECT id,lease_owner_worker_id,project_id,stage,worker_type,project_domain,lease_execution_id FROM worker_work_items WHERE status='LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at<? LIMIT 500").bind(ts).all<Record<string, unknown>>();
  const rows = expired.results || [];
  if (rows.length) {
    const statements = rows.flatMap(row => [
      env.DB.prepare("UPDATE worker_work_items SET status='READY',resume_priority=resume_priority+1,last_action='WATCHDOG_REQUEUE',lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,ready_at=?,updated_at=? WHERE id=? AND status='LEASED'").bind(ts, ts, row.id),
      env.DB.prepare("INSERT INTO worker_events (id,worker_id,worker_type,worker_domain,execution_id,project_id,work_item_id,stage,event_type,status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,'READY','{}',?)")
        .bind(id("WEV"), row.lease_owner_worker_id, row.worker_type, row.project_domain, row.lease_execution_id, row.project_id, row.id, row.stage, "WATCHDOG_REQUEUE", ts),
    ]);
    await env.DB.batch(statements);
  }
  await env.DB.prepare("UPDATE worker_sessions SET status='EXPIRADO',stopped_at=?,updated_at=? WHERE status='ATIVO' AND last_seen_at<?").bind(ts, ts, ts - 15 * 60_000).run();
  return { requeued: rows.length, checkedAt: ts };
}

export async function dispatcherHealth(env: Env) {
  const now = nowMs();
  const [queue, sessions, limits] = await env.DB.batch([
    env.DB.prepare("SELECT status,worker_type,project_domain,COUNT(*) AS count FROM worker_work_items GROUP BY status,worker_type,project_domain"),
    env.DB.prepare("SELECT status,worker_type,worker_domain,COUNT(*) AS count FROM worker_sessions GROUP BY status,worker_type,worker_domain"),
    env.DB.prepare("SELECT * FROM worker_capacity_limits ORDER BY worker_type,worker_domain"),
  ]);
  const expired = await env.DB.prepare("SELECT COUNT(*) AS count FROM worker_work_items WHERE status='LEASED' AND lease_expires_at<?").bind(now).first<{ count:number }>();
  return { ok: Number(expired?.count || 0) === 0, expiredLeases: Number(expired?.count || 0), queue: queue.results || [], sessions: sessions.results || [], limits: limits.results || [] };
}

export async function configureWorkerLimit(env: Env, input: { workerType: string; workerDomain?: string; maxWorkers: number; maxPerProject?: number; enabled?: boolean }) {
  const domain = input.workerDomain || "*";
  const existing = await env.DB.prepare("SELECT id FROM worker_capacity_limits WHERE worker_type=? AND worker_domain=? LIMIT 1").bind(input.workerType, domain).first<{ id:string }>();
  const ts = nowMs();
  if (existing) {
    await env.DB.prepare("UPDATE worker_capacity_limits SET max_workers=?,max_per_project=?,enabled=?,updated_at=? WHERE id=?").bind(Math.max(1,input.maxWorkers),Math.max(1,input.maxPerProject||input.maxWorkers),input.enabled===false?0:1,ts,existing.id).run();
  } else {
    await env.DB.prepare("INSERT INTO worker_capacity_limits (id,worker_type,worker_domain,max_workers,max_per_project,enabled,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id("CAP"),input.workerType,domain,Math.max(1,input.maxWorkers),Math.max(1,input.maxPerProject||input.maxWorkers),input.enabled===false?0:1,ts).run();
  }
  return env.DB.prepare("SELECT * FROM worker_capacity_limits WHERE worker_type=? AND worker_domain=? ORDER BY updated_at DESC LIMIT 1").bind(input.workerType,domain).first<Record<string,unknown>>();
}
