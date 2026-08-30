import type { Env } from "../types";

const RELEASE_MARKER = "operational_clean_release_0_20_9";
const PRESERVED_TABLES = new Set([
  "v2_infrastructure_profiles",
  "v2_infrastructure_config_events",
  "v2_migrations_applied",
  "v2_schema_meta",
  "d1_migrations",
]);

function quoteIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableNames(env: Env) {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all<{ name: string }>();
  return (result.results || []).map(row => String(row.name)).filter(Boolean);
}

async function countIfPresent(env: Env, tables: Set<string>, name: string) {
  if (!tables.has(name)) return 0;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function operationalCleanOnce(env: Env) {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS v2_schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  const previous = await env.DB.prepare("SELECT value FROM v2_schema_meta WHERE key=?")
    .bind(RELEASE_MARKER).first<{ value: string }>();
  const beforeNames = await tableNames(env);
  const before = new Set(beforeNames);

  if (previous?.value === "DONE") {
    return {
      ok: true,
      idempotent: true,
      marker: RELEASE_MARKER,
      assets: await countIfPresent(env, before, "assets"),
      projects: await countIfPresent(env, before, "automatic_projects"),
      preserved: [...PRESERVED_TABLES].filter(name => before.has(name)),
    };
  }

  const targets = beforeNames.filter(name => !PRESERVED_TABLES.has(name) && !name.startsWith("_cf_"));
  const statements = targets.map(name => `DELETE FROM ${quoteIdentifier(name)};`).join("\n");
  // The table list comes from sqlite_master, so legacy installations with a
  // smaller schema are safe: no statement is emitted for a missing table.
  await env.DB.exec(`PRAGMA foreign_keys = OFF;\n${statements}\nPRAGMA foreign_keys = ON;`);
  await env.DB.prepare("DELETE FROM v2_schema_meta WHERE key <> 'schema_version'").run();
  await env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES (?,?,?)")
    .bind(RELEASE_MARKER, "DONE", Date.now()).run();

  const afterNames = new Set(await tableNames(env));
  const assets = await countIfPresent(env, afterNames, "assets");
  const projects = await countIfPresent(env, afterNames, "automatic_projects");
  if (assets !== 0 || projects !== 0) throw new Error(`OPERATIONAL_CLEAN_VERIFICATION_FAILED:${assets}/${projects}`);

  return {
    ok: true,
    idempotent: false,
    marker: RELEASE_MARKER,
    cleanedTables: targets,
    assets,
    projects,
    preserved: [...PRESERVED_TABLES].filter(name => afterNames.has(name)),
  };
}
