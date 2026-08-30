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
};

async function tableColumns(token:string,accountId:string,databaseId:string,table:string) {
  const result=await queryD1<{name?:string}>(token,accountId,databaseId,`PRAGMA table_info(${table})`);
  return new Set((result?.[0]?.results||[]).map(row=>String(row.name||"")).filter(Boolean));
}

async function reconcileCriticalSchemaRemote(token:string,accountId:string,databaseId:string) {
  const repaired:string[]=[];
  const missingTables:string[]=[];
  for(const table of ["v2_ingest_candidates","automatic_project_items","v2_ingest_operations","v2_ingest_events"]){
    if(!(await tableExists(token,accountId,databaseId,table))) missingTables.push(table);
  }
  if(missingTables.length) return {ready:false,contractVersion:"2.18.0",missingTables,missingColumns:[],repaired};
  for(const [table,specs] of Object.entries(CRITICAL_SCHEMA_COLUMNS)){
    let columns=await tableColumns(token,accountId,databaseId,table);
    for(const spec of specs){
      if(columns.has(spec.name)) continue;
      try { await queryD1(token,accountId,databaseId,spec.ddl); }
      catch(error){ columns=await tableColumns(token,accountId,databaseId,table); if(!columns.has(spec.name)) throw error; }
      columns.add(spec.name); repaired.push(`${table}.${spec.name}`);
    }
  }
  await queryD1(token,accountId,databaseId,"UPDATE v2_ingest_candidates SET discovered_at=COALESCE(discovered_at,created_at), queued_at=COALESCE(queued_at,created_at), materialized_at=CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN COALESCE(materialized_at,updated_at) ELSE materialized_at END");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_item_status ON v2_ingest_candidates(project_id,item_id,status,updated_at DESC)");
  await queryD1(token,accountId,databaseId,"CREATE INDEX IF NOT EXISTS idx_project_items_collection_qa ON automatic_project_items(project_id,collection_status,qa_status,priority,updated_at)");
  await queryD1(token,accountId,databaseId,"CREATE TABLE IF NOT EXISTS v2_schema_meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  await queryD1(token,accountId,databaseId,"INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('schema_version','2.18.0',?)",[Date.now()]);
  const missingColumns:Array<{table:string;column:string}>=[];
  for(const [table,specs] of Object.entries(CRITICAL_SCHEMA_COLUMNS)){
    const columns=await tableColumns(token,accountId,databaseId,table);
    for(const spec of specs) if(!columns.has(spec.name)) missingColumns.push({table,column:spec.name});
  }
  return {ready:missingColumns.length===0,contractVersion:"2.18.0",missingTables:[],missingColumns,repaired};
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
  "2.6.0":"9006_v2_persistent_infrastructure.sql", "2.7.0":"9007_v2_migration_registry.sql", "2.8.0":"9008_v2_operational_cleanup_recovery.sql", "2.9.0":"9009_v2_runtime_heartbeats.sql", "2.10.0":"9010_v2_clean_zero_baseline.sql", "2.11.0":"9011_v2_purge_all_projects.sql", "2.12.0":"9012_v2_factory_zero_assets.sql", "2.13.0":"9013_v2_live_factory_zero_gate.sql", "2.14.1":"9014_v2_authoritative_factory_zero.sql", "2.15.0":"9015_v2_operational_clean_once.sql", "2.16.0":"9016_v2_collector_qa_pipeline.sql", "2.17.0":"9017_v2_schema_contract_gate.sql", "2.18.0":"9018_v2_safe_live_migration_executor.sql",
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
