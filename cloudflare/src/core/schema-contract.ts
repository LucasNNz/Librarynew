import type { Env } from "../types";

type ColumnSpec = { name:string; ddl:string };
type TableSpec = { table:string; columns:ColumnSpec[] };

const CONTRACT_VERSION = "2.17.0";

const REQUIRED: TableSpec[] = [
  {
    table: "v2_ingest_candidates",
    columns: [
      { name:"discovered_at", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN discovered_at INTEGER" },
      { name:"queued_at", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN queued_at INTEGER" },
      { name:"download_started_at", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN download_started_at INTEGER" },
      { name:"materialized_at", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN materialized_at INTEGER" },
      { name:"queue_wait_ms", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN queue_wait_ms INTEGER" },
      { name:"download_ms", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN download_ms INTEGER" },
      { name:"r2_write_ms", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN r2_write_ms INTEGER" },
      { name:"d1_finalize_ms", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN d1_finalize_ms INTEGER" },
      { name:"total_materialization_ms", ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN total_materialization_ms INTEGER" },
    ],
  },
  {
    table: "automatic_project_items",
    columns: [
      { name:"target_candidates", ddl:"ALTER TABLE automatic_project_items ADD COLUMN target_candidates INTEGER NOT NULL DEFAULT 8" },
      { name:"required_approved", ddl:"ALTER TABLE automatic_project_items ADD COLUMN required_approved INTEGER NOT NULL DEFAULT 1" },
      { name:"discovered_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN discovered_count INTEGER NOT NULL DEFAULT 0" },
      { name:"queued_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN queued_count INTEGER NOT NULL DEFAULT 0" },
      { name:"downloading_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN downloading_count INTEGER NOT NULL DEFAULT 0" },
      { name:"materialized_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN materialized_count INTEGER NOT NULL DEFAULT 0" },
      { name:"failed_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0" },
      { name:"approved_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN approved_count INTEGER NOT NULL DEFAULT 0" },
      { name:"rejected_count", ddl:"ALTER TABLE automatic_project_items ADD COLUMN rejected_count INTEGER NOT NULL DEFAULT 0" },
      { name:"collection_status", ddl:"ALTER TABLE automatic_project_items ADD COLUMN collection_status TEXT NOT NULL DEFAULT 'EMPTY'" },
      { name:"qa_status", ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_status TEXT NOT NULL DEFAULT 'WAITING_COLLECTION'" },
      { name:"qa_ready_at", ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_ready_at INTEGER" },
      { name:"qa_started_at", ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_started_at INTEGER" },
      { name:"qa_completed_at", ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_completed_at INTEGER" },
    ],
  },
];

async function tableColumns(env:Env, table:string) {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{name:string}>();
  return new Set((rows.results || []).map(row => String(row.name)));
}

async function tableExists(env:Env, table:string) {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(table).first<{name:string}>();
  return Boolean(row?.name);
}

export async function inspectCriticalSchema(env:Env) {
  const missingTables:string[]=[];
  const missingColumns:Array<{table:string;column:string}>=[];
  for (const spec of REQUIRED) {
    if (!(await tableExists(env, spec.table))) { missingTables.push(spec.table); continue; }
    const columns = await tableColumns(env, spec.table);
    for (const column of spec.columns) if (!columns.has(column.name)) missingColumns.push({table:spec.table,column:column.name});
  }
  for (const table of ["v2_ingest_operations","v2_ingest_events"]) if (!(await tableExists(env,table))) missingTables.push(table);
  return {
    ready: missingTables.length===0 && missingColumns.length===0,
    contractVersion: CONTRACT_VERSION,
    missingTables,
    missingColumns,
  };
}

export async function reconcileCriticalSchema(env:Env) {
  const before = await inspectCriticalSchema(env);
  if (before.missingTables.length) return { ...before, repaired:[], error:"CRITICAL_TABLE_MISSING" };

  const repaired:string[]=[];
  for (const spec of REQUIRED) {
    let columns = await tableColumns(env,spec.table);
    for (const column of spec.columns) {
      if (columns.has(column.name)) continue;
      try {
        await env.DB.exec(column.ddl);
        repaired.push(`${spec.table}.${column.name}`);
      } catch (error) {
        // A concurrent request may have added the column after our PRAGMA read.
        columns = await tableColumns(env,spec.table);
        if (!columns.has(column.name)) throw error;
      }
      columns.add(column.name);
    }
  }

  const ts=Date.now();
  await env.DB.prepare(`UPDATE v2_ingest_candidates
    SET discovered_at=COALESCE(discovered_at,created_at),
        queued_at=COALESCE(queued_at,created_at),
        materialized_at=CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN COALESCE(materialized_at,updated_at) ELSE materialized_at END`).run();
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_item_status ON v2_ingest_candidates(project_id,item_id,status,updated_at DESC)");
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_project_items_collection_qa ON automatic_project_items(project_id,collection_status,qa_status,priority,updated_at)");
  await env.DB.exec("CREATE TABLE IF NOT EXISTS v2_schema_meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  await env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('schema_version',?,?)").bind(CONTRACT_VERSION,ts).run();
  await env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('critical_schema_contract','READY',?)").bind(ts).run();

  const after = await inspectCriticalSchema(env);
  return { ...after, repaired };
}

export async function requireCriticalSchema(env:Env) {
  const state = await inspectCriticalSchema(env);
  if (state.ready) return state;
  return reconcileCriticalSchema(env);
}
