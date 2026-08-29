import type { Env } from "../types";
import { id, nowMs } from "./ids";

function cleanList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return [];
}

export async function listRequests(env: Env, limit = 100) {
  const result = await env.DB.prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function createRequest(env: Env, project: string, items: string) {
  const requestId = id("SOL");
  const itemCount = items.split(/\r?\n/).map(v => v.trim()).filter(Boolean).length;
  const createdAt = nowMs();
  await env.DB.prepare("INSERT INTO requests (id,project,raw_items,item_count,status,created_at) VALUES (?,?,?,?,?,?)")
    .bind(requestId, project.trim(), items, itemCount, "Validando", createdAt).run();
  return env.DB.prepare("SELECT * FROM requests WHERE id=?").bind(requestId).first<Record<string, unknown>>();
}

export async function updateRequest(env: Env, requestId: string, input: { projeto?: string; itens?: string; status?: string }) {
  const current = await env.DB.prepare("SELECT * FROM requests WHERE id=?").bind(requestId).first<Record<string, unknown>>();
  if (!current) return null;
  const project = input.projeto !== undefined ? input.projeto.trim() : String(current.project || "");
  const rawItems = input.itens !== undefined ? input.itens : String(current.raw_items || "");
  const itemCount = rawItems.split(/\r?\n/).map(v => v.trim()).filter(Boolean).length;
  const status = input.status !== undefined ? input.status.trim() : String(current.status || "Validando");
  await env.DB.prepare("UPDATE requests SET project=?,raw_items=?,item_count=?,status=? WHERE id=?")
    .bind(project, rawItems, itemCount, status, requestId).run();
  return env.DB.prepare("SELECT * FROM requests WHERE id=?").bind(requestId).first<Record<string, unknown>>();
}

export async function listBatches(env: Env, limit = 100) {
  const result = await env.DB.prepare("SELECT * FROM batches ORDER BY updated_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function createBatch(env: Env, name: string, project?: string, assetIds?: string[]) {
  const batchId = id("LOT");
  const timestamp = nowMs();
  const ids = [...new Set(cleanList(assetIds))].slice(0, 500);
  const statements = [
    env.DB.prepare("INSERT INTO batches (id,name,project,status,manifest_text,created_at,updated_at) VALUES (?,?,?,'Rascunho',NULL,?,?)")
      .bind(batchId, name.trim(), project?.trim() || null, timestamp, timestamp),
    ...ids.map((assetId, position) => env.DB.prepare("INSERT INTO batch_assets (id,batch_id,asset_id,position,slot,note,created_at) VALUES (?,?,?,?,NULL,NULL,?)")
      .bind(id("BA"), batchId, assetId, position, timestamp)),
  ];
  await env.DB.batch(statements);
  return getBatch(env, batchId);
}

export async function getBatch(env: Env, batchId: string) {
  const batch = await env.DB.prepare("SELECT * FROM batches WHERE id=?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) return null;
  const links = await env.DB.prepare(`SELECT ba.id AS link_id,ba.position,ba.slot,ba.note,
      a.id,a.name,a.universe,a.kind,a.status,a.r2_key,a.original_name,a.mime_type,a.size_bytes,a.use_count
      FROM batch_assets ba JOIN assets a ON a.id=ba.asset_id WHERE ba.batch_id=? ORDER BY ba.position ASC`)
    .bind(batchId).all<Record<string, unknown>>();
  return { ...batch, assets: links.results || [] };
}

export async function addAssetsToBatch(env: Env, batchId: string, assetIds: string[]) {
  const batch = await env.DB.prepare("SELECT id FROM batches WHERE id=?").bind(batchId).first();
  if (!batch) return null;
  const ids = [...new Set(cleanList(assetIds))].slice(0, 500);
  const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(position),-1) AS n FROM batch_assets WHERE batch_id=?").bind(batchId).first<{ n:number }>();
  const timestamp = nowMs();
  const statements = ids.map((assetId, index) => env.DB.prepare(
    "INSERT OR IGNORE INTO batch_assets (id,batch_id,asset_id,position,slot,note,created_at) VALUES (?,?,?,?,NULL,NULL,?)",
  ).bind(id("BA"), batchId, assetId, Number(maxRow?.n ?? -1) + 1 + index, timestamp));
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare("UPDATE batches SET updated_at=? WHERE id=?").bind(timestamp, batchId).run();
  return getBatch(env, batchId);
}

export async function removeAssetsFromBatch(env: Env, batchId: string, assetIds: string[]) {
  const ids = [...new Set(cleanList(assetIds))].slice(0, 500);
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM batch_assets WHERE batch_id=? AND asset_id IN (${placeholders})`).bind(batchId, ...ids).run();
  }
  await env.DB.prepare("UPDATE batches SET updated_at=? WHERE id=?").bind(nowMs(), batchId).run();
  return getBatch(env, batchId);
}

export async function updateBatchStatus(env: Env, batchId: string, status: string) {
  const result = await env.DB.prepare("UPDATE batches SET status=?,updated_at=? WHERE id=?").bind(status.trim(), nowMs(), batchId).run();
  if (!result.meta.changes) return null;
  return env.DB.prepare("SELECT * FROM batches WHERE id=?").bind(batchId).first<Record<string, unknown>>();
}

export async function generateBatchManifest(env: Env, batchId: string) {
  const batch = await getBatch(env, batchId);
  if (!batch) return null;
  const assets = Array.isArray(batch.assets) ? batch.assets as Record<string, unknown>[] : [];
  const manifest = [
    `LOTE: ${String(batch.name || "")}`,
    `PROJETO: ${String(batch.project || "")}`,
    `DATA: ${new Date().toISOString()}`,
    "",
    ...assets.flatMap(asset => [
      `[${String(asset.original_name || "")}]`,
      `ASSET_ID: ${String(asset.id || "")}`,
      `NOME_SEMANTICO: ${String(asset.name || "")}`,
      `UNIVERSO: ${String(asset.universe || "")}`,
      `TIPO: ${String(asset.kind || "")}`,
      `SLOT: ${String(asset.slot || "")}`,
      "",
    ]),
  ].join("\n");
  const key = `batches/${batchId}/manifest.txt`;
  await env.MEDIA.put(key, manifest, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  await env.DB.prepare("UPDATE batches SET manifest_text=?,updated_at=? WHERE id=?").bind(manifest, nowMs(), batchId).run();
  return { lote_id: batchId, r2_key: key, manifesto: manifest };
}

export async function listImports(env: Env, limit = 100) {
  const result = await env.DB.prepare("SELECT * FROM imports ORDER BY created_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return result.results || [];
}
