import type { Env } from "../types";
import { id, nowMs } from "./ids";

type ReferenceRow = { source_table: string; source_id: string; r2_key: string };

type R2ObjectLite = { key: string; size: number };

async function allR2Objects(env: Env, maxObjects = 10000) {
  const objects: R2ObjectLite[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ limit: Math.min(1000, maxObjects - objects.length), cursor });
    for (const object of page.objects) objects.push({ key: object.key, size: object.size });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < maxObjects);
  return { objects, truncated: Boolean(cursor) };
}

async function allReferences(env: Env) {
  // Never use DB.batch() or a compound UNION for this inventory. The live D1
  // may contain legacy views whose expansion can exceed SQLite's compound
  // SELECT term limit. Each reference source is queried independently and the
  // Worker merges the rows in memory.
  const sources = [
    { source: "assets", sql: "SELECT id AS source_id,r2_key FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "automatic_project_files", sql: "SELECT id AS source_id,r2_key FROM automatic_project_files WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "automatic_projects", sql: "SELECT id AS source_id,zip_r2_key AS r2_key FROM automatic_projects WHERE zip_r2_key IS NOT NULL AND TRIM(zip_r2_key)<>''" },
    { source: "export_jobs", sql: "SELECT id AS source_id,r2_key FROM export_jobs WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "imports", sql: "SELECT id AS source_id,r2_key FROM imports WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "materialization_files", sql: "SELECT id AS source_id,r2_key FROM materialization_files WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "v2_ingest_candidates", sql: "SELECT id AS source_id,r2_key FROM v2_ingest_candidates WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''" },
    { source: "v2_recovery_events", sql: "SELECT MIN(id) AS source_id,r2_key FROM v2_recovery_events WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>'' GROUP BY r2_key" },
  ] as const;
  const settled = await Promise.allSettled(sources.map(item => env.DB.prepare(item.sql).all<{source_id:string;r2_key:string}>()));
  const rows: ReferenceRow[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const result = settled[index];
    if (result.status !== "fulfilled") {
      console.warn("R2_REFERENCE_SOURCE_SKIPPED", sources[index].source, result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    for (const row of result.value.results || []) {
      const r2Key = String(row.r2_key || "").trim();
      if (r2Key) rows.push({ source_table:sources[index].source, source_id:String(row.source_id || ""), r2_key:r2Key });
    }
  }
  return rows;
}

function bySource(rows: ReferenceRow[], present: Set<string>) {
  const map = new Map<string, { references: number; distinct: Set<string>; present: number; missing: number }>();
  for (const row of rows) {
    const current = map.get(row.source_table) || { references: 0, distinct: new Set<string>(), present: 0, missing: 0 };
    current.references += 1;
    current.distinct.add(row.r2_key);
    if (present.has(row.r2_key)) current.present += 1;
    else current.missing += 1;
    map.set(row.source_table, current);
  }
  return [...map.entries()].map(([source, value]) => ({ source, references: value.references, distinctReferences: value.distinct.size, present: value.present, missing: value.missing }));
}

export async function fullStorageAudit(env: Env, maxObjects = 10000) {
  const auditId = id("AUD");
  const started = nowMs();
  await env.DB.prepare(`INSERT INTO v2_storage_audits (id,status,created_at,updated_at) VALUES (?,'RUNNING',?,?)`).bind(auditId, started, started).run();

  try {
    const [references, inventory] = await Promise.all([allReferences(env), allR2Objects(env, Math.max(1000, Math.min(maxObjects, 50000)))]);
    const r2Keys = new Set(inventory.objects.map(item => item.key));
    const referenceKeys = new Set(references.map(item => item.r2_key));
    const refMap = new Map<string, ReferenceRow[]>();
    for (const row of references) refMap.set(row.r2_key, [...(refMap.get(row.r2_key) || []), row]);

    const missing = [...refMap.entries()].filter(([key]) => !r2Keys.has(key)).map(([key, refs]) => ({ key, references: refs }));
    const shared = [...refMap.entries()].filter(([, refs]) => refs.length > 1).map(([key, refs]) => ({ key, references: refs }));
    const orphan = inventory.objects.filter(item => !referenceKeys.has(item.key));
    const presentReferences = references.filter(item => r2Keys.has(item.r2_key)).length;
    const totalBytes = inventory.objects.reduce((sum, item) => sum + Number(item.size || 0), 0);
    const summary = {
      auditId,
      status: "COMPLETED",
      inventoryTruncated: inventory.truncated,
      totalReferences: references.length,
      distinctReferences: referenceKeys.size,
      r2Objects: inventory.objects.length,
      r2Bytes: totalBytes,
      presentReferences,
      missingReferences: missing.length,
      orphanObjects: orphan.length,
      sharedKeys: shared.length,
      bySource: bySource(references, r2Keys),
      missing: missing.slice(0, 250),
      orphan: orphan.slice(0, 250),
      shared: shared.slice(0, 250),
    };
    const done = nowMs();
    await env.DB.prepare(`UPDATE v2_storage_audits SET status='COMPLETED',total_references=?,distinct_references=?,r2_objects=?,present_references=?,missing_references=?,orphan_objects=?,shared_keys=?,summary_json=?,updated_at=?,completed_at=? WHERE id=?`)
      .bind(references.length, referenceKeys.size, inventory.objects.length, presentReferences, missing.length, orphan.length, shared.length, JSON.stringify(summary), done, done, auditId).run();
    return summary;
  } catch (error) {
    const done = nowMs();
    const message = error instanceof Error ? error.message.slice(0, 500) : "AUDIT_FAILED";
    await env.DB.prepare(`UPDATE v2_storage_audits SET status='FAILED',summary_json=?,updated_at=?,completed_at=? WHERE id=?`).bind(JSON.stringify({ error: message }), done, done, auditId).run();
    throw error;
  }
}

export async function latestStorageAudit(env: Env) {
  const row = await env.DB.prepare("SELECT * FROM v2_storage_audits ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>();
  if (!row) return null;
  let summary: unknown = {};
  try { summary = JSON.parse(String(row.summary_json || "{}")); } catch { summary = {}; }
  return { ...row, summary };
}
