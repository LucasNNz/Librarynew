import type { Env } from "../types";
import { nowMs } from "./ids";

const clampTtl = (seconds: number | undefined, fallback = 300, max = 7200) => Math.max(30, Math.min(seconds || fallback, max));
const heartbeatId = (scopeType: string, scopeId: string) => `HB:${scopeType.toUpperCase()}:${scopeId}`;

export async function recordRuntimeHeartbeat(env: Env, input: { scopeType: string; scopeId: string; ownerId: string; executionId: string; ttlSeconds: number; metadata?: unknown }) {
  const ts = nowMs();
  const ttl = clampTtl(input.ttlSeconds, 300, 7200);
  const expires = ts + ttl * 1000;
  const id = heartbeatId(input.scopeType, input.scopeId);
  await env.DB.prepare(`INSERT INTO v2_runtime_heartbeats
    (id,scope_type,scope_id,owner_id,execution_id,status,ttl_seconds,last_seen_at,lease_expires_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,execution_id=excluded.execution_id,status='ACTIVE',ttl_seconds=excluded.ttl_seconds,last_seen_at=excluded.last_seen_at,lease_expires_at=excluded.lease_expires_at,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(id,input.scopeType.toUpperCase(),input.scopeId,input.ownerId,input.executionId,ttl,ts,expires,JSON.stringify(input.metadata || {}),ts,ts).run();
  return { id, scopeType: input.scopeType.toUpperCase(), scopeId: input.scopeId, ownerId: input.ownerId, executionId: input.executionId, lastSeenAt: ts, leaseExpiresAt: expires, remainingMs: expires-ts, ttlSeconds: ttl };
}

export async function expireRuntimeHeartbeat(env: Env, scopeType: string, scopeId: string, status = "EXPIRED") {
  const ts=nowMs();
  await env.DB.prepare("UPDATE v2_runtime_heartbeats SET status=?,updated_at=? WHERE scope_type=? AND scope_id=? AND status='ACTIVE'")
    .bind(status,ts,scopeType.toUpperCase(),scopeId).run();
}

export async function heartbeatOperation(env: Env, input: { operationId: string; ownerId: string; executionId: string; ttlSeconds?: number; reclaimExpired?: boolean; metadata?: unknown }) {
  const ts=nowMs();
  const operation=await env.DB.prepare("SELECT id,type,status FROM v2_ingest_operations WHERE id=?").bind(input.operationId).first<{id:string;type:string;status:string}>();
  if(!operation) return { error:"OPERATION_NOT_FOUND", status:404 } as const;
  if(["COMPLETED","FAILED","CANCELLED"].includes(String(operation.status).toUpperCase())) return { error:"OPERATION_ALREADY_FINAL", operationStatus:operation.status, status:409 } as const;
  const ttl=clampTtl(input.ttlSeconds,300,3600),expires=ts+ttl*1000,id=heartbeatId("OPERATION",input.operationId),metadata=JSON.stringify({operationType:operation.type,operationStatus:operation.status,...(typeof input.metadata==="object"&&input.metadata?input.metadata as Record<string,unknown>:{})});
  const row=await env.DB.prepare(`INSERT INTO v2_runtime_heartbeats
    (id,scope_type,scope_id,owner_id,execution_id,status,ttl_seconds,last_seen_at,lease_expires_at,metadata_json,created_at,updated_at)
    VALUES (?,'OPERATION',?,?,?,'ACTIVE',?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,execution_id=excluded.execution_id,status='ACTIVE',ttl_seconds=excluded.ttl_seconds,last_seen_at=excluded.last_seen_at,lease_expires_at=excluded.lease_expires_at,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    WHERE (v2_runtime_heartbeats.owner_id=excluded.owner_id AND v2_runtime_heartbeats.execution_id=excluded.execution_id AND v2_runtime_heartbeats.status='ACTIVE' AND v2_runtime_heartbeats.lease_expires_at>=?)
       OR (v2_runtime_heartbeats.lease_expires_at<? AND ?=1)
    RETURNING *`)
    .bind(id,input.operationId,input.ownerId,input.executionId,ttl,ts,expires,metadata,ts,ts,ts,ts,input.reclaimExpired===true?1:0).first<Record<string,unknown>>();
  if(!row){
    const existing=await env.DB.prepare("SELECT * FROM v2_runtime_heartbeats WHERE id=?").bind(id).first<Record<string,unknown>>();
    if(existing && Number(existing.lease_expires_at||0)<ts && input.reclaimExpired!==true) return { error:"EXPIRED_HEARTBEAT_REQUIRES_EXPLICIT_RECLAIM", previousOwnerId:existing.owner_id, previousExecutionId:existing.execution_id, leaseExpiresAt:existing.lease_expires_at, status:409 } as const;
    return { error:"HEARTBEAT_OWNED_BY_ANOTHER_EXECUTION", ownerId:existing?.owner_id, executionId:existing?.execution_id, leaseExpiresAt:existing?.lease_expires_at, status:409 } as const;
  }
  return { ok:true, operationId:input.operationId, operationType:operation.type, operationStatus:operation.status, id, scopeType:"OPERATION", scopeId:input.operationId, ownerId:input.ownerId, executionId:input.executionId, lastSeenAt:ts, leaseExpiresAt:expires, remainingMs:expires-ts, ttlSeconds:ttl, status:200 } as const;
}

export async function runtimeHeartbeatStatus(env: Env, input: { scopeType?: string; limit?: number } = {}) {
  const ts=nowMs(); const limit=Math.max(1,Math.min(input.limit||100,500));
  const where=input.scopeType?"WHERE scope_type=?":""; const args:unknown[]=input.scopeType?[input.scopeType.toUpperCase(),limit]:[limit];
  const rows=await env.DB.prepare(`SELECT *,MAX(0,lease_expires_at-?) AS remaining_ms FROM v2_runtime_heartbeats ${where} ORDER BY updated_at DESC LIMIT ?`)
    .bind(ts,...args).all<Record<string,unknown>>();
  const counts=await env.DB.prepare("SELECT scope_type,status,COUNT(*) AS count FROM v2_runtime_heartbeats GROUP BY scope_type,status ORDER BY scope_type,status").all<Record<string,unknown>>();
  return { now:ts, counts:counts.results||[], items:rows.results||[] };
}

export async function runtimeHeartbeatWatchdog(env: Env) {
  const ts=nowMs();
  const expired=await env.DB.prepare("SELECT id,scope_type,scope_id,owner_id,execution_id,lease_expires_at FROM v2_runtime_heartbeats WHERE status='ACTIVE' AND lease_expires_at<? LIMIT 1000").bind(ts).all<Record<string,unknown>>();
  const rows=expired.results||[];
  if(rows.length) await env.DB.prepare("UPDATE v2_runtime_heartbeats SET status='EXPIRED',updated_at=? WHERE status='ACTIVE' AND lease_expires_at<?").bind(ts,ts).run();
  return { expired:rows.length, checkedAt:ts, items:rows };
}
