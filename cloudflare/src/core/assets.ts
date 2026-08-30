import type { Env, LegacyAssetRow } from "../types";
import { createSignedFileUrl } from "./auth";

const statusMap: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente",
  REJECTED: "Rejeitado",
  APROVADO: "Aprovado",
  PENDENTE: "Pendente",
  REJEITADO: "Rejeitado",
};

const apiStatusMap: Record<string, string> = {
  Aprovado: "APPROVED",
  Pendente: "PENDING",
  Rejeitado: "REJECTED",
};

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function encodeCursor(updatedAt: number, id: string) {
  return btoa(JSON.stringify([updatedAt, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const raw = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const [updatedAt, id] = JSON.parse(atob(padded));
    if (!Number.isFinite(Number(updatedAt)) || typeof id !== "string") return null;
    return { updatedAt: Number(updatedAt), id };
  } catch {
    return null;
  }
}

export async function listAssets(request: Request, env: Env) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 48), 200));
  const q = (url.searchParams.get("q") || "").trim();
  const universe = (url.searchParams.get("universe") || "").trim();
  const requestedStatus = (url.searchParams.get("status") || "").trim();
  const kind = (url.searchParams.get("kind") || "").trim();
  const neverUsed = ["1","true","yes"].includes((url.searchParams.get("neverUsed") || "").toLowerCase());
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  const where: string[] = [];
  const values: unknown[] = [];
  if (q) {
    where.push("(name LIKE ? OR universe LIKE ? OR subject LIKE ? OR tags LIKE ?)");
    const like = `%${q}%`;
    values.push(like, like, like, like);
  }
  if (universe) {
    where.push("universe = ?");
    values.push(universe);
  }
  if (requestedStatus) {
    where.push("status = ?");
    values.push(statusMap[requestedStatus.toUpperCase()] || requestedStatus);
  }
  if (kind) {
    where.push("kind = ?");
    values.push(kind);
  }
  if (neverUsed) where.push("use_count = 0");
  if (cursor) {
    where.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }

  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const countWhere = where.filter(part => !part.includes("updated_at < ?"));
  const countValues = cursor ? values.slice(0, -3) : values;
  const countClause = countWhere.length ? ` WHERE ${countWhere.join(" AND ")}` : "";

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM assets${countClause}`).bind(...countValues).first<{ n: number }>();
  const result = await env.DB.prepare(`SELECT * FROM assets${clause} ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(...values, limit + 1).all<LegacyAssetRow>();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const items = await Promise.all(page.map(async row => ({
    id: row.id,
    name: row.name,
    universe: row.universe,
    subject: row.subject,
    kind: row.kind,
    status: apiStatusMap[row.status] || row.status.toUpperCase(),
    rawStatus: row.status,
    tags: parseTags(row.tags),
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    r2Key: row.r2_key,
    uses: Number(row.use_count || 0),
    lastUsedAt: row.last_used_at,
    qaStatus: row.qa_status,
    previewUrl: await createSignedFileUrl(request, row.id, env),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  })));

  const last = page[page.length - 1];
  return {
    items,
    total: Number(countRow?.n || 0),
    nextCursor: hasMore && last ? encodeCursor(Number(last.updated_at), last.id) : null,
  };
}

export async function catalogStats(env: Env) {
  const [totals, universes] = await env.DB.batch([
    env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='Aprovado' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status='Pendente' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='Rejeitado' THEN 1 ELSE 0 END) AS rejected,
      COALESCE(SUM(size_bytes),0) AS bytes,
      COALESCE(SUM(use_count),0) AS uses,
      SUM(CASE WHEN use_count > 1 THEN 1 ELSE 0 END) AS reused
      FROM assets`),
    env.DB.prepare("SELECT COUNT(DISTINCT universe) AS n, COUNT(DISTINCT CASE WHEN status='Aprovado' THEN universe END) AS approved_n FROM assets WHERE TRIM(universe) <> '' AND LOWER(TRIM(universe)) <> 'sem universo'"),
  ]);
  const row = (totals.results?.[0] || {}) as Record<string, unknown>;
  const uni = (universes.results?.[0] || {}) as Record<string, unknown>;
  return {
    total: Number(row.total || 0),
    approved: Number(row.approved || 0),
    pending: Number(row.pending || 0),
    rejected: Number(row.rejected || 0),
    bytes: Number(row.bytes || 0),
    uses: Number(row.uses || 0),
    reused: Number(row.reused || 0),
    universes: Number(uni.approved_n || 0),
    allUniverses: Number(uni.n || 0),
  };
}

export async function listUniverses(env: Env) {
  const result = await env.DB.prepare(`SELECT universe, COUNT(*) AS total,
    SUM(CASE WHEN status='Aprovado' THEN 1 ELSE 0 END) AS approved,
    SUM(CASE WHEN status='Pendente' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status='Rejeitado' THEN 1 ELSE 0 END) AS rejected
    FROM assets WHERE TRIM(universe) <> '' GROUP BY universe ORDER BY universe COLLATE NOCASE ASC`).all<Record<string, unknown>>();
  return (result.results || []).map(row => ({
    name: String(row.universe || ""),
    total: Number(row.total || 0),
    approved: Number(row.approved || 0),
    pending: Number(row.pending || 0),
    rejected: Number(row.rejected || 0),
  }));
}

export async function getAsset(request: Request, assetId: string, env: Env) {
  const row = await env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first<LegacyAssetRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    universe: row.universe,
    subject: row.subject,
    kind: row.kind,
    status: apiStatusMap[row.status] || row.status.toUpperCase(),
    rawStatus: row.status,
    tags: parseTags(row.tags),
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    r2Key: row.r2_key,
    uses: Number(row.use_count || 0),
    lastUsedAt: row.last_used_at,
    qaStatus: row.qa_status,
    previewUrl: await createSignedFileUrl(request, row.id, env, 300),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

export async function getAssetLinks(request: Request, assetIds: string[], env: Env) {
  const ids = [...new Set(assetIds.map(String).filter(Boolean))].slice(0, 200);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT id,name,r2_key FROM assets WHERE id IN (${placeholders})`).bind(...ids).all<{ id:string; name:string; r2_key:string }>();
  return Promise.all((result.results || []).map(async row => ({ id:row.id, name:row.name, r2Key:row.r2_key, url:await createSignedFileUrl(request,row.id,env,300) })));
}

export async function getAssetLink(request: Request, assetId: string, env: Env, ttlSeconds = 300) {
  const row = await env.DB.prepare("SELECT id,name,r2_key,mime_type,size_bytes FROM assets WHERE id=?").bind(assetId).first<{ id:string; name:string; r2_key:string; mime_type:string; size_bytes:number }>();
  if (!row) return null;
  return { asset_id: row.id, nome: row.name, r2_key: row.r2_key, mime_type: row.mime_type, tamanho_bytes: Number(row.size_bytes || 0), url: await createSignedFileUrl(request, row.id, env, Math.max(60, Math.min(ttlSeconds, 3600))) };
}
