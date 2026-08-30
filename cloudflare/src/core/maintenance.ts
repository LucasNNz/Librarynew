import type { Env } from "../types";
import { nowMs } from "./ids";
import { refreshRecoveryAfterWrite } from "./recovery-manifest";

async function deletePrefix(env: Env, prefix: string) {
  let cursor: string | undefined;
  let deleted = 0;
  let bytes = 0;
  do {
    const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map(object => object.key);
    bytes += page.objects.reduce((sum, object) => sum + Number(object.size || 0), 0);
    for (let i = 0; i < keys.length; i += 1000) {
      const slice = keys.slice(i, i + 1000);
      if (slice.length) await env.MEDIA.delete(slice);
      deleted += slice.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { deleted, bytes };
}

export async function runPendingMaintenance(env: Env) {
  const row = await env.DB.prepare("SELECT * FROM v2_maintenance_state WHERE key='PURGE_LEGACY_PROJECT_R2' LIMIT 1")
    .first<Record<string,unknown>>().catch(() => null);
  if (!row || String(row.status) === "DONE" || String(row.status) === "RUNNING") return { ran:false, status:row?.status || "NONE" };
  const claim = await env.DB.prepare(`UPDATE v2_maintenance_state SET status='RUNNING',attempts=attempts+1,updated_at=?
    WHERE key='PURGE_LEGACY_PROJECT_R2' AND status IN ('PENDING','FAILED')`).bind(nowMs()).run();
  if (Number(claim.meta?.changes || 0) !== 1) return { ran:false, status:"CLAIMED_ELSEWHERE" };
  try {
    const result = await deletePrefix(env,"projects/");
    const ts = nowMs();
    await env.DB.prepare("UPDATE v2_maintenance_state SET status='DONE',detail_json=?,updated_at=?,completed_at=? WHERE key='PURGE_LEGACY_PROJECT_R2'")
      .bind(JSON.stringify({prefix:"projects/",...result}),ts,ts).run();
    await refreshRecoveryAfterWrite(env,"LEGACY_PROJECTS_PURGED","projects/");
    return { ran:true, status:"DONE", ...result };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE v2_maintenance_state SET status='FAILED',detail_json=?,updated_at=? WHERE key='PURGE_LEGACY_PROJECT_R2'")
      .bind(JSON.stringify({error:detail}),nowMs()).run().catch(() => undefined);
    return { ran:true, status:"FAILED", error:detail };
  }
}

export async function maintenanceStatus(env: Env) {
  const rows = await env.DB.prepare("SELECT * FROM v2_maintenance_state ORDER BY key").all<Record<string,unknown>>().catch(() => ({results:[],success:true,meta:{}} as unknown as D1Result<Record<string,unknown>>));
  return { items: rows.results || [] };
}
