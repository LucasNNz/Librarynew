import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { cfApi, queryD1 } from "../../../../../lib/cloudflare-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { apiToken?: string; accountId?: string; databaseId?: string; force?: boolean };

const LEGACY_DESTRUCTIVE_MIGRATIONS = new Set([
  "9008_v2_operational_cleanup_recovery.sql",
  "9010_v2_clean_zero_baseline.sql",
  "9011_v2_purge_all_projects.sql",
  "9012_v2_factory_zero_assets.sql",
  "9013_v2_live_factory_zero_gate.sql",
]);

async function tableExists(token: string, accountId: string, databaseId: string, table: string) {
  try {
    const result = await queryD1<{ name?: string }>(token, accountId, databaseId, "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [table]);
    return Boolean(result?.[0]?.results?.[0]?.name);
  } catch { return false; }
}

const CRITICAL_SCHEMA_COLUMNS: Record<string, Array<{name:string;ddl:string}>> = {
  v2_ingest_candidates: [
    {name:"discovered_at",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN discovered_at INTEGER"},
    {name:"queued_at",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN queued_at INTEGER"},
    {name:"download_started_at",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN download_started_at INTEGER"},
    {name:"materialized_at",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN materialized_at INTEGER"},
    {name:"queue_wait_ms",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN queue_wait_ms INTEGER"},
    {name:"download_ms",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN download_ms INTEGER"},
    {name:"r2_write_ms",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN r2_write_ms INTEGER"},
    {name:"d1_finalize_ms",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN d1_finalize_ms INTEGER"},
    {name:"total_materialization_ms",ddl:"ALTER TABLE v2_ingest_candidates ADD COLUMN total_materialization_ms INTEGER"},
  ],
  automatic_project_items: [
    {name:"target_candidates",ddl:"ALTER TABLE automatic_project_items ADD COLUMN target_candidates INTEGER NOT NULL DEFAULT 8"},
    {name:"required_approved",ddl:"ALTER TABLE automatic_project_items ADD COLUMN required_approved INTEGER NOT NULL DEFAULT 1"},
    {name:"discovered_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN discovered_count INTEGER NOT NULL DEFAULT 0"},
    {name:"queued_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN queued_count INTEGER NOT NULL DEFAULT 0"},
    {name:"downloading_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN downloading_count INTEGER NOT NULL DEFAULT 0"},
    {name:"materialized_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN materialized_count INTEGER NOT NULL DEFAULT 0"},
    {name:"failed_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0"},
    {name:"approved_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN approved_count INTEGER NOT NULL DEFAULT 0"},
    {name:"rejected_count",ddl:"ALTER TABLE automatic_project_items ADD COLUMN rejected_count INTEGER NOT NULL DEFAULT 0"},
    {name:"collection_status",ddl:"ALTER TABLE automatic_project_items ADD COLUMN collection_status TEXT NOT NULL DEFAULT 'EMPTY'"},
    {name:"qa_status",ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_status TEXT NOT NULL DEFAULT 'WAITING_COLLECTION'"},
    {name:"qa_ready_at",ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_ready_at INTEGER"},
    {name:"qa_started_at",ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_started_at INTEGER"},
    {name:"qa_completed_at",ddl:"ALTER TABLE automatic_project_items ADD COLUMN qa_completed_at INTEGER"},
  ],
  automatic_projects: [
    {name:"lifecycle_status",ddl:"ALTER TABLE automatic_projects ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE'"},
    {name:"mcp_locked",ddl:"ALTER TABLE automatic_projects ADD COLUMN mcp_locked INTEGER NOT NULL DEFAULT 0"},
    {name:"rejected_at",ddl:"ALTER TABLE automatic_projects ADD COLUMN rejected_at INTEGER"},
    {name:"closed_reason",ddl:"ALTER TABLE automatic_projects ADD COLUMN closed_reason TEXT"},
    {name:"workflow_updated_at",ddl:"ALTER TABLE automatic_projects ADD COLUMN workflow_updated_at INTEGER"},
    {name:"production_reconciled_at",ddl:"ALTER TABLE automatic_projects ADD COLUMN production_reconciled_at INTEGER"},
  ],
  v2_project_media: [
    {name:"slot_index",ddl:"ALTER TABLE v2_project_media ADD COLUMN slot_index INTEGER"},
    {name:"orientation",ddl:"ALTER TABLE v2_project_media ADD COLUMN orientation TEXT"},
  ],
  v2_project_titles: [
    {name:"slot_index",ddl:"ALTER TABLE v2_project_titles ADD COLUMN slot_index INTEGER"},
  ],
  v2_download_packages: [
    {name:"revision_hash",ddl:"ALTER TABLE v2_download_packages ADD COLUMN revision_hash TEXT"},
    {name:"mime_type",ddl:"ALTER TABLE v2_download_packages ADD COLUMN mime_type TEXT"},
  ],
  v2_production_slots: [
    {name:"visual_role",ddl:"ALTER TABLE v2_production_slots ADD COLUMN visual_role TEXT"},
    {name:"previous_asset_id",ddl:"ALTER TABLE v2_production_slots ADD COLUMN previous_asset_id TEXT REFERENCES assets(id)"},
    {name:"relink_required_at",ddl:"ALTER TABLE v2_production_slots ADD COLUMN relink_required_at INTEGER"},
    {name:"relink_reason",ddl:"ALTER TABLE v2_production_slots ADD COLUMN relink_reason TEXT"},
    {name:"rejected_by",ddl:"ALTER TABLE v2_production_slots ADD COLUMN rejected_by TEXT"},
    {name:"rejected_operation_id",ddl:"ALTER TABLE v2_production_slots ADD COLUMN rejected_operation_id TEXT"},
    {name:"candidate_id",ddl:"ALTER TABLE v2_production_slots ADD COLUMN candidate_id TEXT REFERENCES v2_ingest_candidates(id)"},
    {name:"previous_candidate_id",ddl:"ALTER TABLE v2_production_slots ADD COLUMN previous_candidate_id TEXT REFERENCES v2_ingest_candidates(id)"},
    {name:"assigned_for_qa_at",ddl:"ALTER TABLE v2_production_slots ADD COLUMN assigned_for_qa_at INTEGER"},
    {name:"qa_finalized_at",ddl:"ALTER TABLE v2_production_slots ADD COLUMN qa_finalized_at INTEGER"},
    {name:"qa_operation_id",ddl:"ALTER TABLE v2_production_slots ADD COLUMN qa_operation_id TEXT"},
    {name:"assignment_source",ddl:"ALTER TABLE v2_production_slots ADD COLUMN assignment_source TEXT"},
  ],
  v2_production_slot_history: [
    {name:"previous_candidate_id",ddl:"ALTER TABLE v2_production_slot_history ADD COLUMN previous_candidate_id TEXT REFERENCES v2_ingest_candidates(id)"},
    {name:"new_candidate_id",ddl:"ALTER TABLE v2_production_slot_history ADD COLUMN new_candidate_id TEXT REFERENCES v2_ingest_candidates(id)"},
  ],
};

async function tableColumns(token:string,accountId:string,databaseId:string,table:string) {
  const result=await queryD1<{name?:string}>(token,accountId,databaseId,`PRAGMA table_info(${table})`);
  return new Set((result?.[0]?.results||[]).map(row=>String(row.name||"")).filter(Boolean));
}

async function reconcileCriticalSchemaRemote(token:string,accountId:string,databaseId:string) {
  const repaired:string[]=[];
  const missingTables:string[]=[];
  if(!(await tableExists(token,accountId,databaseId,"v2_mcp_route_telemetry"))){
    await queryD1(token,accountId,databaseId,`CREATE TABLE IF NOT EXISTS v2_mcp_route_telemetry (id TEXT PRIMARY KEY NOT NULL,tool TEXT NOT NULL,success INTEGER NOT NULL DEFAULT 1,duration_ms INTEGER NOT NULL DEFAULT 0,db_query_count INTEGER NOT NULL DEFAULT 0,meta_covered_queries INTEGER NOT NULL DEFAULT 0,rows_read_observed INTEGER NOT NULL DEFAULT 0,rows_written_observed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)`);
    await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_mcp_route_telemetry_created ON v2_mcp_route_telemetry(created_at DESC)");
    await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_mcp_route_telemetry_tool_created ON v2_mcp_route_telemetry(tool,created_at DESC)");
    repaired.push("table:v2_mcp_route_telemetry");
  }
  if(!(await tableExists(token,accountId,databaseId,"v2_project_workflow_tags"))){
    await queryD1(token,accountId,databaseId,`CREATE TABLE IF NOT EXISTS v2_project_workflow_tags (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES automatic_projects(id),tag TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE',owner_id TEXT,execution_id TEXT,ttl_seconds INTEGER,last_seen_at INTEGER,lease_expires_at INTEGER,metadata_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,ended_at INTEGER)`);
    await queryD1(token,accountId,databaseId,"CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_workflow_tag_unique ON v2_project_workflow_tags(project_id,tag)");
    repaired.push("table:v2_project_workflow_tags");
  }
  for(const table of ["v2_ingest_candidates","automatic_project_items","automatic_projects","v2_project_media","v2_project_titles","v2_download_packages","v2_ingest_operations","v2_ingest_events","v2_production_slots","v2_production_slot_history","v2_mcp_route_telemetry"]){
    if(!(await tableExists(token,accountId,databaseId,table))) missingTables.push(table);
  }
  if(missingTables.length) return {ready:false,contractVersion:"2.27.0",missingTables,missingColumns:[],repaired};
  for(const [table,specs] of Object.entries(CRITICAL_SCHEMA_COLUMNS)){
    let columns=await tableColumns(token,accountId,databaseId,table);
    for(const spec of specs){
      if(columns.has(spec.name)) continue;
      try { await queryD1(token,accountId,databaseId,spec.ddl); }
      catch(error){ columns=await tableColumns(token,accountId,databaseId,table); if(!columns.has(spec.name)) throw error; }
      columns.add(spec.name); repaired.push(`${table}.${spec.name}`);
    }
  }
  await queryD1(token,accountId,databaseId,"UPDATE v2_production_slots SET status='FROZEN', qa_finalized_at=COALESCE(qa_finalized_at,updated_at), assignment_source=COALESCE(NULLIF(assignment_source,''),'LEGACY_QA_APPROVED') WHERE asset_id IS NOT NULL AND candidate_id IS NULL AND status IN ('RESOLVED','APPROVED','COMPLETED')");
  await queryD1(token,accountId,databaseId,"UPDATE v2_ingest_candidates SET discovered_at=COALESCE(discovered_at,created_at), queued_at=COALESCE(queued_at,created_at), materialized_at=CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN COALESCE(materialized_at,updated_at) ELSE materialized_at END");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_item_status ON v2_ingest_candidates(project_id,item_id,status,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_items_collection_qa ON automatic_project_items(project_id,collection_status,qa_status,priority,updated_at)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_automatic_projects_lifecycle_updated ON automatic_projects(lifecycle_status,updated_at DESC,id DESC)");
  await queryD1(token,accountId,databaseId,"CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_media_slot ON v2_project_media(project_id,kind,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('THUMB_REJECTED','REJECTED')");
  await queryD1(token,accountId,databaseId,"CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_titles_slot ON v2_project_titles(project_id,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('TITLE_REJECTED','REJECTED')");
  await queryD1(token,accountId,databaseId,"CREATE TABLE IF NOT EXISTS v2_schema_meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_pslot_relink_required ON v2_production_slots(project_id,status,updated_at DESC) WHERE status='RELINK_REQUIRED'");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_pslot_assigned_for_qa ON v2_production_slots(project_id,status,updated_at DESC) WHERE status='ASSIGNED_FOR_QA'");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_pslot_candidate ON v2_production_slots(candidate_id) WHERE candidate_id IS NOT NULL");
  await queryD1(token,accountId,databaseId,"CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_pslot_history_operation ON v2_production_slot_history(project_id,slot_id,event,operation_id) WHERE operation_id IS NOT NULL AND operation_id<>''");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_pslot_history_slot ON v2_production_slot_history(project_id,slot_id,created_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_automatic_projects_actionable ON automatic_projects(queue_priority DESC,updated_at ASC,id ASC) WHERE COALESCE(lifecycle_status,'ACTIVE')='ACTIVE' AND next_action IS NOT NULL");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_items_project_status ON automatic_project_items(project_id,status,priority DESC,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_items_project_priority ON automatic_project_items(project_id,priority DESC,created_at ASC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_files_project_role ON automatic_project_files(project_id,role,version DESC,created_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_events_project_created ON automatic_project_events(project_id,created_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_ready_claim ON worker_work_items(worker_type,project_domain,resume_priority DESC,priority DESC,original_ready_at ASC,ready_at ASC) WHERE status='READY'");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_project_item_active ON worker_work_items(project_id,item_id,status,worker_type,stage)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_project_status ON worker_work_items(project_id,status,worker_type,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_lease_expiry ON worker_work_items(status,lease_expires_at) WHERE status='LEASED'");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_status_type_domain ON worker_work_items(status,worker_type,project_domain)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_worker_sessions_status_type_domain ON worker_sessions(status,worker_type,worker_domain)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_status ON v2_ingest_candidates(project_id,status,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_project_slot_access_project ON v2_project_slot_access(project_id,slot_key)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_operational_policies_active_scope ON operational_policies(rule_type,status,scope_level,project_id,preset,priority DESC,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_production_slot_project_version_status ON v2_production_slots(project_id,version,status,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_production_slot_reference_pool ON v2_production_slots(reference_pool_id,status)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_project_workflow_tag_lookup ON v2_project_workflow_tags(project_id,status,tag,lease_expires_at,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_slot_tags_project_key_active ON v2_slot_tags(project_id,tag_key,active,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_project_media_lookup ON v2_project_media(project_id,kind,status,selected,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_project_titles_lookup ON v2_project_titles(project_id,status,slot_index,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_download_packages_project_type_status ON v2_download_packages(project_id,type,status,created_at DESC)");
  await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('schema_version','2.27.0',?)",[Date.now()]);
  const missingColumns:Array<{table:string;column:string}>=[];
  for(const [table,specs] of Object.entries(CRITICAL_SCHEMA_COLUMNS)){
    const columns=await tableColumns(token,accountId,databaseId,table);
    for(const spec of specs) if(!columns.has(spec.name)) missingColumns.push({table,column:spec.name});
  }
  return {ready:missingColumns.length===0,contractVersion:"2.27.0",missingTables:[],missingColumns,repaired};
}

async function migrationFiles() {
  const dir = path.join(process.cwd(), "cloudflare", "migrations");
  const files = (await readdir(dir)).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort();
  return Promise.all(files.map(async (name: string) => ({ name, sql: String(await readFile(path.join(dir, name), "utf8")) })));
}

async function bootstrapSql() {
  const compressed = await readFile(path.join(process.cwd(), "bootstrap", "CORVO_LIBRARY_V2_D1_CLEAN_BASELINE.sql.gz"));
  const baseline = gunzipSync(compressed).toString("utf8");
  const migrations = (await migrationFiles()).filter(item=>!LEGACY_DESTRUCTIVE_MIGRATIONS.has(item.name));
  return `${baseline}\n\n-- CORVO V2 SAFE FORWARD MIGRATIONS\n${migrations.map(item => item.sql).join("\n\n")}`;
}

async function importD1(token: string, accountId: string, databaseId: string, sql: string) {
  const etag = createHash("md5").update(sql).digest("hex");
  const base = `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/import`;
  const init = await cfApi<{ upload_url?: string; filename?: string; at_bookmark?: string; status?: string; success?: boolean }>(token, base, {
    method: "POST",
    body: JSON.stringify({ action: "init", etag }),
  });
  if (init.status === "complete" && init.success) return { status: "complete", reused: true };
  if (!init.upload_url || !init.filename) throw new Error("D1_IMPORT_INIT_INVALID");
  const upload = await fetch(init.upload_url, { method: "PUT", body: sql, headers: { "content-type": "application/sql" } });
  if (!upload.ok) throw new Error(`D1_IMPORT_UPLOAD_HTTP_${upload.status}`);
  const returnedEtag = (upload.headers.get("etag") || "").replace(/\"/g, "");
  if (returnedEtag && returnedEtag !== etag) throw new Error("D1_IMPORT_ETAG_MISMATCH");
  const ingest = await cfApi<{ at_bookmark?: string; status?: string; success?: boolean; error?: string }>(token, base, {
    method: "POST",
    body: JSON.stringify({ action: "ingest", etag, filename: init.filename }),
  });
  let bookmark = ingest.at_bookmark;
  if (ingest.status === "complete" && ingest.success) return { status: "complete", reused: false };
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (!bookmark) throw new Error(ingest.error || "D1_IMPORT_BOOKMARK_MISSING");
    await new Promise(resolve => setTimeout(resolve, 1000));
    const poll = await cfApi<{ at_bookmark?: string; status?: string; success?: boolean; error?: string; result?: { num_queries?: number } }>(token, base, {
      method: "POST",
      body: JSON.stringify({ action: "poll", current_bookmark: bookmark }),
    });
    bookmark = poll.at_bookmark || bookmark;
    if (poll.status === "complete" || poll.success) return { status: "complete", reused: false, numQueries: poll.result?.num_queries || null };
    if (poll.status === "error" || poll.error) throw new Error(poll.error || "D1_IMPORT_FAILED");
  }
  throw new Error("D1_IMPORT_TIMEOUT");
}

const VERSION_LAST_MIGRATION: Record<string,string> = {
  "2.0.0":"9000_v2_core.sql", "2.1.0":"9001_v2_observability.sql", "2.2.0":"9002_v2_direct_upload.sql",
  "2.3.0":"9003_v2_control_plane.sql", "2.4.0":"9004_v2_archives.sql", "2.5.0":"9005_v2_delivery_hardening.sql",
  "2.6.0":"9006_v2_persistent_infrastructure.sql", "2.7.0":"9007_v2_migration_registry.sql", "2.8.0":"9008_v2_operational_cleanup_recovery.sql", "2.9.0":"9009_v2_runtime_heartbeats.sql", "2.10.0":"9010_v2_clean_zero_baseline.sql", "2.11.0":"9011_v2_purge_all_projects.sql", "2.12.0":"9012_v2_factory_zero_assets.sql", "2.13.0":"9013_v2_live_factory_zero_gate.sql", "2.14.1":"9014_v2_authoritative_factory_zero.sql", "2.15.0":"9015_v2_operational_clean_once.sql", "2.16.0":"9016_v2_collector_qa_pipeline.sql", "2.17.0":"9017_v2_schema_contract_gate.sql", "2.18.0":"9018_v2_safe_live_migration_executor.sql", "2.19.0":"9019_v2_project_slots_workflow.sql",
  "2.20.0":"9020_v2_project_slot_customization.sql", "2.21.0":"9021_v2_production_model.sql", "2.22.0":"9022_v2_final_exports_forma.sql", "2.23.0":"9023_v2_persistent_slot_visual_tags.sql", "2.24.0":"9024_v2_persistent_operational_policies.sql", "2.25.0":"9025_v2_production_slot_rejection.sql", "2.26.0":"9026_v2_qa_by_rejection.sql", "2.27.0":"9027_v2_d1_read_optimization.sql",
};

async function currentSchemaVersion(token: string, accountId: string, databaseId: string) {
  try {
    const value = await queryD1<{ value?: string }>(token, accountId, databaseId, "SELECT value FROM v2_schema_meta WHERE key='schema_version' LIMIT 1");
    return String(value?.[0]?.results?.[0]?.value || "");
  } catch { return ""; }
}

async function ensureMigrationRegistry(token: string, accountId: string, databaseId: string, files: Array<{name:string;sql:string}>) {
  await queryD1(token, accountId, databaseId, "CREATE TABLE IF NOT EXISTS v2_migrations_applied (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL DEFAULT '', applied_at INTEGER NOT NULL)");
  const rows = await queryD1<{ name?: string }>(token, accountId, databaseId, "SELECT name FROM v2_migrations_applied ORDER BY name");
  const applied = new Set((rows?.[0]?.results || []).map(row => String(row.name || "")).filter(Boolean));
  if (applied.size === 0) {
    const version = await currentSchemaVersion(token, accountId, databaseId);
    const last = VERSION_LAST_MIGRATION[version];
    if (last) {
      for (const item of files) {
        if (item.name > last) break;
        const checksum = createHash("sha256").update(item.sql).digest("hex");
        await queryD1(token, accountId, databaseId, "INSERT OR IGNORE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)", [item.name, checksum, Date.now()]);
        applied.add(item.name);
      }
    }
  }
  return applied;
}

async function applyPendingMigrations(token: string, accountId: string, databaseId: string) {
  const files = await migrationFiles();
  const applied = await ensureMigrationRegistry(token, accountId, databaseId, files);
  const executed: string[] = [];
  const skippedLegacy: string[] = [];

  await queryD1(token,accountId,databaseId,`CREATE TABLE IF NOT EXISTS v2_migration_decisions (
    name TEXT PRIMARY KEY NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    decided_at INTEGER NOT NULL
  )`);

  const preSchemaContract=await reconcileCriticalSchemaRemote(token,accountId,databaseId).catch(()=>null);
  const collectorMigration=files.find(item=>item.name==="9016_v2_collector_qa_pipeline.sql");
  if(preSchemaContract?.ready && collectorMigration && !applied.has(collectorMigration.name)){
    const checksum=createHash("sha256").update(collectorMigration.sql).digest("hex");
    const now=Date.now();
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)",[collectorMigration.name,checksum,now]);
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[collectorMigration.name,"APPLIED","schema_contract_reconciled",checksum,now]);
    applied.add(collectorMigration.name);
  }
  const productionSlotRejectionMigration=files.find(item=>item.name==="9025_v2_production_slot_rejection.sql");
  if(preSchemaContract?.ready && productionSlotRejectionMigration && !applied.has(productionSlotRejectionMigration.name)){
    const checksum=createHash("sha256").update(productionSlotRejectionMigration.sql).digest("hex");
    const now=Date.now();
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)",[productionSlotRejectionMigration.name,checksum,now]);
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[productionSlotRejectionMigration.name,"APPLIED","schema_contract_reconciled",checksum,now]);
    applied.add(productionSlotRejectionMigration.name);
  }
  const qaByRejectionMigration=files.find(item=>item.name==="9026_v2_qa_by_rejection.sql");
  if(preSchemaContract?.ready && qaByRejectionMigration && !applied.has(qaByRejectionMigration.name)){
    const checksum=createHash("sha256").update(qaByRejectionMigration.sql).digest("hex");
    const now=Date.now();
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)",[qaByRejectionMigration.name,checksum,now]);
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[qaByRejectionMigration.name,"APPLIED","schema_contract_reconciled",checksum,now]);
    applied.add(qaByRejectionMigration.name);
  }
  const d1ReadOptimizationMigration=files.find(item=>item.name==="9027_v2_d1_read_optimization.sql");
  if(preSchemaContract?.ready && d1ReadOptimizationMigration && !applied.has(d1ReadOptimizationMigration.name)){
    const checksum=createHash("sha256").update(d1ReadOptimizationMigration.sql).digest("hex");
    const now=Date.now();
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)",[d1ReadOptimizationMigration.name,checksum,now]);
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[d1ReadOptimizationMigration.name,"APPLIED","schema_contract_reconciled",checksum,now]);
    applied.add(d1ReadOptimizationMigration.name);
  }

  for (const item of files) {
    if (applied.has(item.name)) continue;
    const checksum = createHash("sha256").update(item.sql).digest("hex");
    const now=Date.now();
    if (LEGACY_DESTRUCTIVE_MIGRATIONS.has(item.name)) {
      await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)",[item.name,checksum,now]);
      await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[item.name,"SKIPPED_LEGACY_DESTRUCTIVE","historical_reset_not_safe_for_live_restore",checksum,now]);
      applied.add(item.name);
      skippedLegacy.push(item.name);
      continue;
    }
    await importD1(token, accountId, databaseId, item.sql);
    await queryD1(token, accountId, databaseId, "INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)", [item.name, checksum, now]);
    await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)",[item.name,"APPLIED","normal_forward_migration",checksum,now]);
    applied.add(item.name);
    executed.push(item.name);
  }
  const schemaContract=await reconcileCriticalSchemaRemote(token,accountId,databaseId);
  if(!schemaContract.ready) throw new Error(`SCHEMA_CONTRACT_NOT_READY:${JSON.stringify(schemaContract)}`);
  return {executed,skippedLegacy,schemaContract};
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const token = String(body.apiToken || "").trim();
    const accountId = String(body.accountId || "").trim();
    const databaseId = String(body.databaseId || "").trim();
    if (!token || !accountId || !databaseId) return NextResponse.json({ error: "TOKEN_ACCOUNT_DATABASE_REQUIRED" }, { status: 400 });

    const hasAssets = await tableExists(token, accountId, databaseId, "assets");
    const hasV2 = await tableExists(token, accountId, databaseId, "v2_schema_meta");
    if (!hasAssets || body.force) {
      const sql = await bootstrapSql();
      const result = await importD1(token, accountId, databaseId, sql);
      const schemaContract=await reconcileCriticalSchemaRemote(token,accountId,databaseId);
      return NextResponse.json({ ok: true, imported: true, bytes: Buffer.byteLength(sql), migrationsApplied: (await migrationFiles()).filter(item=>!LEGACY_DESTRUCTIVE_MIGRATIONS.has(item.name)).map(item=>item.name), schemaContract, ...result }, { headers: { "cache-control": "no-store" } });
    }

    // Existing historical/V2 database: never restore again. Only migrations that are not registered are applied.
    const migrationResult = await applyPendingMigrations(token, accountId, databaseId);
    return NextResponse.json({ ok: true, skippedHistoricalRestore: true, hadV2: hasV2, migrationsApplied:migrationResult.executed, migrationsSkippedLegacy:migrationResult.skippedLegacy, schemaContract:migrationResult.schemaContract }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "D1_RESTORE_FAILED" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
