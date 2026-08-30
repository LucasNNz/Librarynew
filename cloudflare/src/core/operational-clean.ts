import type { Env } from "../types";

const RELEASE_MARKER = "operational_clean_release_0_20_10";
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

async function foreignKeyParents(env: Env, table: string) {
  const result = await env.DB.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
    .all<{ table: string }>();
  return new Set((result.results || []).map(row => String(row.table)).filter(Boolean));
}

async function deletionOrder(env: Env, targets: string[]) {
  const targetSet = new Set(targets);
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const table of targets) {
    outgoing.set(table, new Set());
    incoming.set(table, new Set());
  }
  for (const child of targets) {
    const parents = await foreignKeyParents(env, child);
    for (const parent of parents) {
      if (!targetSet.has(parent) || parent === child) continue;
      outgoing.get(child)!.add(parent);
      incoming.get(parent)!.add(child);
    }
  }

  const ready = targets.filter(table => incoming.get(table)!.size === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    const child = ready.shift()!;
    order.push(child);
    for (const parent of outgoing.get(child)!) {
      const references = incoming.get(parent)!;
      references.delete(child);
      if (references.size === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }
  const cyclic = targets.filter(table => !order.includes(table));
  if (cyclic.length) throw new Error(`OPERATIONAL_CLEAN_FK_CYCLE:${cyclic.join(",")}`);
  return order;
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
  // D1 rejects changing foreign_keys inside its managed transaction. Discover
  // the real FK graph instead and delete children before their parent tables.
  const orderedTargets = await deletionOrder(env, targets);
  for (const table of orderedTargets) {
    try {
      await env.DB.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`OPERATIONAL_CLEAN_TABLE_FAILED:${table}:${detail}`);
    }
  }
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
    cleanedTables: orderedTargets,
    assets,
    projects,
    preserved: [...PRESERVED_TABLES].filter(name => afterNames.has(name)),
  };
}
