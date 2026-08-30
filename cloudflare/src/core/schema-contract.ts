import type { Env } from "../types";

type ColumnSpec = { name:string; ddl:string };
type TableSpec = { table:string; columns:ColumnSpec[] };

const CONTRACT_VERSION = "2.22.0";

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
  {
    table: "automatic_projects",
    columns: [
      { name:"lifecycle_status", ddl:"ALTER TABLE automatic_projects ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE'" },
      { name:"mcp_locked", ddl:"ALTER TABLE automatic_projects ADD COLUMN mcp_locked INTEGER NOT NULL DEFAULT 0" },
      { name:"rejected_at", ddl:"ALTER TABLE automatic_projects ADD COLUMN rejected_at INTEGER" },
      { name:"closed_reason", ddl:"ALTER TABLE automatic_projects ADD COLUMN closed_reason TEXT" },
      { name:"workflow_updated_at", ddl:"ALTER TABLE automatic_projects ADD COLUMN workflow_updated_at INTEGER" },
    ],
  },
  {
    table: "v2_project_media",
    columns: [
      { name:"slot_index", ddl:"ALTER TABLE v2_project_media ADD COLUMN slot_index INTEGER" },
      { name:"orientation", ddl:"ALTER TABLE v2_project_media ADD COLUMN orientation TEXT" },
    ],
  },
  {
    table: "v2_project_titles",
    columns: [
      { name:"slot_index", ddl:"ALTER TABLE v2_project_titles ADD COLUMN slot_index INTEGER" },
    ],
  },
  {
    table: "v2_download_packages",
    columns: [
      { name:"revision_hash", ddl:"ALTER TABLE v2_download_packages ADD COLUMN revision_hash TEXT" },
      { name:"mime_type", ddl:"ALTER TABLE v2_download_packages ADD COLUMN mime_type TEXT" },
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
  for (const table of ["v2_ingest_operations","v2_ingest_events","v2_project_workflow_tags","v2_project_slot_access","v2_reference_pools","v2_production_scenes","v2_production_slots"]) if (!(await tableExists(env,table))) missingTables.push(table);
  return {
    ready: missingTables.length===0 && missingColumns.length===0,
    contractVersion: CONTRACT_VERSION,
    missingTables,
    missingColumns,
  };
}

export async function reconcileCriticalSchema(env:Env) {
  let before = await inspectCriticalSchema(env);
  const repaired:string[]=[];
  if(before.missingTables.includes("v2_project_workflow_tags")){
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS v2_project_workflow_tags (
      id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES automatic_projects(id),tag TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE',owner_id TEXT,execution_id TEXT,ttl_seconds INTEGER,last_seen_at INTEGER,lease_expires_at INTEGER,metadata_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,ended_at INTEGER)`);
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_workflow_tag_unique ON v2_project_workflow_tags(project_id,tag)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_v2_project_workflow_active ON v2_project_workflow_tags(project_id,status,lease_expires_at,updated_at DESC)");
    repaired.push("table:v2_project_workflow_tags");
    before=await inspectCriticalSchema(env);
  }
  if(before.missingTables.includes("v2_project_slot_access")){
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS v2_project_slot_access (project_id TEXT NOT NULL,slot_key TEXT NOT NULL,mcp_open INTEGER NOT NULL DEFAULT 0,instruction TEXT,opened_by TEXT,opened_at INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,slot_key),FOREIGN KEY(project_id) REFERENCES automatic_projects(id) ON DELETE CASCADE)`);
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_v2_project_slot_access_open ON v2_project_slot_access(mcp_open,updated_at DESC)");
    repaired.push("table:v2_project_slot_access");
    before=await inspectCriticalSchema(env);
  }
  if(before.missingTables.some(table=>["v2_reference_pools","v2_production_scenes","v2_production_slots"].includes(table))){
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS v2_reference_pools (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 1,pool_key TEXT NOT NULL,subject TEXT,universe TEXT,semantic_reference TEXT,status TEXT NOT NULL DEFAULT 'PENDING',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS v2_production_scenes (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 1,scene_key TEXT NOT NULL,scene_number INTEGER,title TEXT,universe TEXT,subject TEXT,concept TEXT,semantic_reference TEXT,script_excerpt TEXT,preset TEXT,context TEXT,composition_class TEXT NOT NULL DEFAULT 'CONTEXTUAL',status TEXT NOT NULL DEFAULT 'READY',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS v2_production_slots (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 1,scene_id TEXT REFERENCES v2_production_scenes(id) ON DELETE CASCADE,slot_key TEXT NOT NULL,slot_index INTEGER NOT NULL DEFAULT 1,target_file TEXT,subject TEXT,universe TEXT,semantic_reference TEXT,reference_pool_id TEXT REFERENCES v2_reference_pools(id),preset TEXT,context TEXT,composition_class TEXT NOT NULL DEFAULT 'CONTEXTUAL',asset_id TEXT REFERENCES assets(id),status TEXT NOT NULL DEFAULT 'UNRESOLVED',observation TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_reference_pool_unique ON v2_reference_pools(project_id,version,pool_key)");
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_scene_unique ON v2_production_scenes(project_id,version,scene_key)");
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_slot_key_unique ON v2_production_slots(project_id,version,slot_key)");
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_target_unique ON v2_production_slots(project_id,version,target_file) WHERE target_file IS NOT NULL AND target_file<>''");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_v2_production_slot_status ON v2_production_slots(project_id,status,updated_at DESC)");
    repaired.push("tables:production_model");
    before=await inspectCriticalSchema(env);
  }
  const hardMissing=before.missingTables.filter(table=>!['v2_project_workflow_tags','v2_project_slot_access','v2_reference_pools','v2_production_scenes','v2_production_slots'].includes(table));
  if (hardMissing.length) return { ...before, repaired, error:"CRITICAL_TABLE_MISSING" };

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
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_automatic_projects_lifecycle_updated ON automatic_projects(lifecycle_status,updated_at DESC,id DESC)");
  await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_media_slot ON v2_project_media(project_id,kind,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('THUMB_REJECTED','REJECTED')");
  await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_titles_slot ON v2_project_titles(project_id,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('TITLE_REJECTED','REJECTED')");
  await env.DB.prepare(`UPDATE automatic_projects SET lifecycle_status=CASE WHEN upper(COALESCE(status,'')) IN ('COMPLETED','DONE','CONCLUIDO','CONCLUÍDO') THEN 'COMPLETED' WHEN upper(COALESCE(status,'')) IN ('REJECTED','REJEITADO','CANCELLED','CANCELADO') THEN 'REJECTED' ELSE COALESCE(NULLIF(lifecycle_status,''),'ACTIVE') END,mcp_locked=CASE WHEN upper(COALESCE(status,'')) IN ('COMPLETED','DONE','CONCLUIDO','CONCLUÍDO','REJECTED','REJEITADO','CANCELLED','CANCELADO') THEN 1 ELSE COALESCE(mcp_locked,0) END,workflow_updated_at=COALESCE(workflow_updated_at,updated_at)`).run();
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
