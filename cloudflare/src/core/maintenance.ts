import type { Env } from "../types";
import { nowMs } from "./ids";
import { refreshRecoveryAfterWrite } from "./recovery-manifest";

type MaintenanceRow = Record<string, unknown>;
type PurgeDetail = {
  prefixes?: string[];
  preserve?: string[];
  reason?: string;
  currentPrefixIndex?: number;
  deleted?: number;
  bytes?: number;
  lastPrefix?: string;
  lastBatchDeleted?: number;
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function parseDetail(value: unknown): PurgeDetail {
  try { return JSON.parse(clean(value) || "{}") as PurgeDetail; } catch { return {}; }
}

async function deleteOnePage(env: Env, prefix: string) {
  // Always read the first page. Because the page is deleted immediately, the next
  // maintenance run naturally advances without relying on a cursor over a mutating set.
  const page = await env.MEDIA.list({ prefix, limit: 1000 });
  const keys = page.objects.map(object => object.key);
  const bytes = page.objects.reduce((sum, object) => sum + Number(object.size || 0), 0);
  if (keys.length) await env.MEDIA.delete(keys);
  return { deleted: keys.length, bytes };
}

async function claim(env: Env, key: string) {
  const ts = nowMs();
  // A stale RUNNING claim may be recovered after five minutes.
  const result = await env.DB.prepare(`UPDATE v2_maintenance_state
    SET status='RUNNING',attempts=attempts+1,updated_at=?
    WHERE key=? AND (status IN ('PENDING','FAILED') OR (status='RUNNING' AND updated_at<?))`)
    .bind(ts, key, ts - 5 * 60_000).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function runPrefixPurge(env: Env, row: MaintenanceRow) {
  const key = clean(row.key);
  const detail = parseDetail(row.detail_json);
  const prefixes = Array.isArray(detail.prefixes) && detail.prefixes.length
    ? detail.prefixes.map(clean).filter(Boolean)
    : key === "PURGE_LEGACY_PROJECT_R2" ? ["projects/"] : [];
  if (!prefixes.length) throw new Error("MAINTENANCE_PREFIXES_MISSING");

  let index = Math.max(0, Math.min(Number(detail.currentPrefixIndex || 0), prefixes.length));
  let deleted = Number(detail.deleted || 0);
  let bytes = Number(detail.bytes || 0);

  while (index < prefixes.length) {
    const prefix = prefixes[index];
    const page = await deleteOnePage(env, prefix);
    deleted += page.deleted;
    bytes += page.bytes;

    if (page.deleted > 0) {
      const nextDetail: PurgeDetail = {
        ...detail,
        prefixes,
        currentPrefixIndex: index,
        deleted,
        bytes,
        lastPrefix: prefix,
        lastBatchDeleted: page.deleted,
      };
      await env.DB.prepare(`UPDATE v2_maintenance_state
        SET status='PENDING',detail_json=?,updated_at=? WHERE key=?`)
        .bind(JSON.stringify(nextDetail), nowMs(), key).run();
      return { ran:true, status:"PARTIAL", key, prefix, batchDeleted:page.deleted, deleted, bytes };
    }
    index += 1;
  }

  const ts = nowMs();
  const finalDetail: PurgeDetail = { ...detail, prefixes, currentPrefixIndex: prefixes.length, deleted, bytes, lastBatchDeleted:0 };
  await env.DB.prepare(`UPDATE v2_maintenance_state
    SET status='DONE',detail_json=?,updated_at=?,completed_at=? WHERE key=?`)
    .bind(JSON.stringify(finalDetail), ts, ts, key).run();
  await refreshRecoveryAfterWrite(env, "LEGACY_PROJECTS_PURGED", prefixes.join(","));
  return { ran:true, status:"DONE", key, deleted, bytes, prefixes };
}

export async function runPendingMaintenance(env: Env) {
  const row = await env.DB.prepare(`SELECT * FROM v2_maintenance_state
    WHERE status IN ('PENDING','FAILED') OR (status='RUNNING' AND updated_at<?)
    ORDER BY created_at,key LIMIT 1`)
    .bind(nowMs() - 5 * 60_000).first<MaintenanceRow>().catch(() => null);
  if (!row) return { ran:false, status:"NONE" };
  const key = clean(row.key);
  if (!await claim(env,key)) return { ran:false, status:"CLAIMED_ELSEWHERE", key };
  try {
    if (key === "PURGE_LEGACY_PROJECT_R2") return await runPrefixPurge(env,row);
    throw new Error(`UNKNOWN_MAINTENANCE_TASK:${key}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE v2_maintenance_state SET status='FAILED',detail_json=?,updated_at=? WHERE key=?`)
      .bind(JSON.stringify({ ...parseDetail(row.detail_json), error:message }),nowMs(),key).run().catch(() => undefined);
    return { ran:true, status:"FAILED", key, error:message };
  }
}

export async function maintenanceStatus(env: Env) {
  const rows = await env.DB.prepare("SELECT * FROM v2_maintenance_state ORDER BY key")
    .all<Record<string,unknown>>().catch(() => ({results:[],success:true,meta:{}} as unknown as D1Result<Record<string,unknown>>));
  return { items: rows.results || [] };
}
