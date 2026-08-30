import type { Env } from "../types";
import { nowMs } from "./ids";

const RELEASE_KEY = "factory_zero_release_0_20_5";
const SCHEMA_VERSION = "2.20.0";

const CONTENT_TABLES = [
  "asset_consultations","asset_usage","batch_assets","assets",
  "automatic_project_events","automatic_project_files","automatic_project_items","automatic_projects",
  "batches","collection_batches","collection_candidates","collection_source_runs","collection_terms",
  "export_jobs","imports","materialization_batches","materialization_candidates","materialization_files",
  "materialization_host_health","materialization_host_probes","materialization_items","materialization_logs",
  "mcp_audit","operation_results","operational_gaps","operational_policy_events","plan_branches","project_runs",
  "queue_snapshots","requests","source_route_metrics","source_routing_plans","stage_metrics","supervisor_config_events",
  "supervisor_decision_queue","supervisor_executions","supervisor_plans","supervisor_project_candidates",
  "worker_events","worker_sessions","worker_work_items","settings","collection_sources","source_profiles",
  "worker_capacity_limits","operational_policies","semantic_stock_policies","v2_ingest_candidates","v2_ingest_events",
  "v2_ingest_operations","v2_storage_audits","v2_direct_uploads","v2_control_jobs","v2_download_packages",
  "v2_project_media","v2_project_titles","v2_project_slot_access","v2_collection_events","v2_asset_exports","v2_recovery_events","v2_runtime_heartbeats"
] as const;

const R2_PREFIXES = ["assets/","imports/","projects/","incoming/","batches/","exports/","corvo-core/recovery/"];

async function existingTables(env: Env) {
  const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all<{name:string}>();
  return new Set((result.results || []).map(row => String(row.name)));
}

async function tableCount(env: Env, table: string, tables?: Set<string>) {
  const known = tables || await existingTables(env);
  if (!known.has(table)) return 0;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{count:number}>();
  return Number(row?.count || 0);
}

export async function factoryZeroStatus(env: Env) {
  const tables = await existingTables(env);
  let marker: string | null = null;
  if (tables.has("v2_schema_meta")) {
    const row = await env.DB.prepare("SELECT value FROM v2_schema_meta WHERE key=?").bind(RELEASE_KEY).first<{value:string}>();
    marker = row?.value ? String(row.value) : null;
  }
  const [assets, projects, imports, requests, batches] = await Promise.all([
    tableCount(env,"assets",tables), tableCount(env,"automatic_projects",tables), tableCount(env,"imports",tables),
    tableCount(env,"requests",tables), tableCount(env,"batches",tables),
  ]);
  return {
    release: "0.20.5",
    schemaVersion: SCHEMA_VERSION,
    marker,
    required: marker !== "DONE",
    counts: { assets, projects, imports, requests, batches },
    preserved: ["v2_infrastructure_profiles","v2_infrastructure_config_events","v2_migrations_applied","D1 binding","R2 binding"],
  };
}

export async function executeFactoryZero(env: Env, confirm: string) {
  if (confirm !== "FACTORY_ZERO_0_20_5") throw new Error("FACTORY_ZERO_CONFIRMATION_REQUIRED");
  const before = await factoryZeroStatus(env);
  if (!before.required) return { ok:true, idempotent:true, before, after:before };

  const tables = await existingTables(env);
  const deletable = CONTENT_TABLES.filter(table => tables.has(table));
  for (let offset = 0; offset < deletable.length; offset += 20) {
    const chunk = deletable.slice(offset, offset + 20);
    await env.DB.batch(chunk.map(table => env.DB.prepare(`DELETE FROM ${table}`)));
  }

  const ts = nowMs();
  if (!tables.has("v2_schema_meta")) {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS v2_schema_meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  }
  await env.DB.prepare("DELETE FROM v2_schema_meta WHERE key NOT IN ('schema_version')").run();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('schema_version',?,?)").bind(SCHEMA_VERSION,ts),
    env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('data_baseline','FACTORY_ZERO',?)").bind(ts),
    env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('assets_baseline','FACTORY_ZERO',?)").bind(ts),
    env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('projects_baseline','FACTORY_ZERO',?)").bind(ts),
    env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES (?, 'DONE', ?)").bind(RELEASE_KEY,ts),
  ]);

  if (tables.has("v2_maintenance_state")) {
    await env.DB.prepare("DELETE FROM v2_maintenance_state").run();
    await env.DB.prepare(`INSERT INTO v2_maintenance_state(key,status,detail_json,attempts,created_at,updated_at,completed_at)
      VALUES ('PURGE_FACTORY_ZERO_R2_0_20_5','PENDING',?,0,?,?,NULL)`)
      .bind(JSON.stringify({prefixes:R2_PREFIXES,preserveBucket:true,refreshRecovery:false,reason:"0.20.5 one-request authoritative factory zero"}),ts,ts).run();
  }

  const after = await factoryZeroStatus(env);
  return { ok:true, idempotent:false, deletedTables:deletable.length, before, after, r2PurgeScheduled:tables.has("v2_maintenance_state"), r2Prefixes:R2_PREFIXES };
}
