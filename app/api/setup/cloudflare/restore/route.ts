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

async function tableExists(token: string, accountId: string, databaseId: string, table: string) {
  try {
    const result = await queryD1<{ name?: string }>(token, accountId, databaseId, "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [table]);
    return Boolean(result?.[0]?.results?.[0]?.name);
  } catch { return false; }
}

async function migrationFiles() {
  const dir = path.join(process.cwd(), "cloudflare", "migrations");
  const files = (await readdir(dir)).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort();
  return Promise.all(files.map(async (name: string) => ({ name, sql: String(await readFile(path.join(dir, name), "utf8")) })));
}

async function bootstrapSql() {
  const compressed = await readFile(path.join(process.cwd(), "bootstrap", "CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql.gz"));
  const historical = gunzipSync(compressed).toString("utf8");
  const migrations = await migrationFiles();
  return `${historical}\n\n-- CORVO V2 MIGRATIONS\n${migrations.map(item => item.sql).join("\n\n")}`;
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
  "2.6.0":"9006_v2_persistent_infrastructure.sql", "2.7.0":"9007_v2_migration_registry.sql",
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
  for (const item of files) {
    if (applied.has(item.name)) continue;
    await importD1(token, accountId, databaseId, item.sql);
    const checksum = createHash("sha256").update(item.sql).digest("hex");
    await queryD1(token, accountId, databaseId, "INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)", [item.name, checksum, Date.now()]);
    executed.push(item.name);
  }
  return executed;
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
      return NextResponse.json({ ok: true, imported: true, bytes: Buffer.byteLength(sql), migrationsApplied: (await migrationFiles()).map(item=>item.name), ...result }, { headers: { "cache-control": "no-store" } });
    }

    // Existing historical/V2 database: never restore again. Only migrations that are not registered are applied.
    const migrationsApplied = await applyPendingMigrations(token, accountId, databaseId);
    return NextResponse.json({ ok: true, skippedHistoricalRestore: true, hadV2: hasV2, migrationsApplied }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "D1_RESTORE_FAILED" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
