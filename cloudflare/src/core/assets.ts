import type { Env, LegacyAssetRow } from "../types";
import { createSignedFileUrl, createSignedThumbnailUrl } from "./auth";

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

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function encodeJsonCursor(value: unknown) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeJsonCursor(value: string | null) {
  if (!value) return null;
  try {
    const raw = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function encodeCursor(updatedAt: number, id: string) { return encodeJsonCursor([updatedAt, id]); }
function decodeCursor(value: string | null) {
  const decoded=decodeJsonCursor(value);
  if (!Array.isArray(decoded)) return null;
  const [updatedAt,id]=decoded;
  if (!Number.isFinite(Number(updatedAt)) || typeof id !== "string") return null;
  return {updatedAt:Number(updatedAt),id};
}

async function syncAssetSearchIndex(env: Env) {
  let synced=0;
  for (let round=0;round<100;round++) {
    const stale=await env.DB.prepare(`SELECT a.id,a.name,a.universe,a.subject,a.kind,a.tags,a.updated_at
      FROM assets a LEFT JOIN v2_asset_search_index si ON si.asset_id=a.id
      WHERE si.asset_id IS NULL OR si.updated_at<>a.updated_at
      ORDER BY a.updated_at ASC,a.id ASC LIMIT 200`).all<Record<string,unknown>>();
    const rows=stale.results||[];
    if(!rows.length)break;
    await env.DB.batch(rows.map(row=>env.DB.prepare(`INSERT OR REPLACE INTO v2_asset_search_index(asset_id,name_norm,universe_norm,subject_norm,kind_norm,tags_norm,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(String(row.id),normalizeSearchText(row.name),normalizeSearchText(row.universe),normalizeSearchText(row.subject),normalizeSearchText(row.kind),normalizeSearchText(row.tags),Number(row.updated_at||0))));
    synced+=rows.length;
    if(rows.length<200)break;
  }
  return synced;
}

function normalizedFilterSql(alias="si") {
  return {
    q:`(${alias}.name_norm LIKE ? OR ${alias}.universe_norm LIKE ? OR ${alias}.subject_norm LIKE ? OR ${alias}.tags_norm LIKE ?)`,
    universe:`${alias}.universe_norm = ?`,
    kind:`${alias}.kind_norm = ?`,
  };
}

export async function listAssets(request: Request, env: Env) {
  await syncAssetSearchIndex(env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 48), 200));
  const q = normalizeSearchText(url.searchParams.get("q") || "");
  const universe = normalizeSearchText(url.searchParams.get("universe") || "");
  const requestedStatus = (url.searchParams.get("status") || "").trim();
  const kind = normalizeSearchText(url.searchParams.get("kind") || "");
  const neverUsed = ["1","true","yes"].includes((url.searchParams.get("neverUsed") || "").toLowerCase());
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const f=normalizedFilterSql();

  const where: string[] = [];
  const values: unknown[] = [];
  if (q) { where.push(f.q); const like=`%${q}%`; values.push(like,like,like,like); }
  if (universe) { where.push(f.universe); values.push(universe); }
  if (requestedStatus) { where.push("a.status = ?"); values.push(statusMap[requestedStatus.toUpperCase()] || requestedStatus); }
  if (kind) { where.push(f.kind); values.push(kind); }
  if (neverUsed) where.push("COALESCE(a.use_count,0) = 0");
  if (cursor) { where.push("(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))"); values.push(cursor.updatedAt,cursor.updatedAt,cursor.id); }

  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const countWhere = cursor ? where.slice(0,-1) : where;
  const countValues = cursor ? values.slice(0,-3) : values;
  const countClause = countWhere.length ? ` WHERE ${countWhere.join(" AND ")}` : "";
  const from="assets a LEFT JOIN v2_asset_search_index si ON si.asset_id=a.id";

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}${countClause}`).bind(...countValues).first<{ n: number }>();
  const result = await env.DB.prepare(`SELECT a.* FROM ${from}${clause} ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`).bind(...values, limit + 1).all<LegacyAssetRow>();
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
    previewUrl: await createSignedThumbnailUrl(request, row.id, env),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  })));

  const last = page[page.length - 1];
  return {items,total:Number(countRow?.n || 0),nextCursor:hasMore&&last?encodeCursor(Number(last.updated_at),last.id):null,normalization:"CASE_INSENSITIVE_ACCENT_INSENSITIVE_BASIC_TEXT"};
}

export type RoteiroCatalogInput={
  limit?:number;cursor?:string;q?:string;universo?:string;subject?:string;tipo?:string;tag?:string;nunca_usado?:boolean;max_usos?:number;
};

export async function listRoteiroCatalog(env:Env,input:RoteiroCatalogInput={}){
  await syncAssetSearchIndex(env);
  const limit=Math.max(1,Math.min(Number(input.limit||100),300));
  const q=normalizeSearchText(input.q),universo=normalizeSearchText(input.universo),subject=normalizeSearchText(input.subject),tipo=normalizeSearchText(input.tipo),tag=normalizeSearchText(input.tag);
  const maxUses=input.max_usos==null?null:Math.max(0,Number(input.max_usos));
  const decoded=decodeJsonCursor(input.cursor||null);
  const cursor=Array.isArray(decoded)&&decoded.length===4?{bucket:Number(decoded[0]),uses:Number(decoded[1]),last:Number(decoded[2]),id:String(decoded[3])}:null;
  const where=["a.status='Aprovado'"];const values:unknown[]=[];
  if(q){const like=`%${q}%`;where.push("(si.name_norm LIKE ? OR si.universe_norm LIKE ? OR si.subject_norm LIKE ? OR si.tags_norm LIKE ?)");values.push(like,like,like,like);}
  if(universo){where.push("si.universe_norm=?");values.push(universo);}
  if(subject){where.push("si.subject_norm LIKE ?");values.push(`%${subject}%`);}
  if(tipo){where.push("si.kind_norm=?");values.push(tipo);}
  if(tag){where.push("si.tags_norm LIKE ?");values.push(`%${tag}%`);}
  if(input.nunca_usado)where.push("COALESCE(a.use_count,0)=0");
  if(maxUses!=null&&Number.isFinite(maxUses)){where.push("COALESCE(a.use_count,0)<=?");values.push(maxUses);}
  const bucket="CASE WHEN COALESCE(a.use_count,0)=0 THEN 0 ELSE 1 END";
  const last="COALESCE(a.last_used_at,0)";
  if(cursor&&Number.isFinite(cursor.bucket)&&Number.isFinite(cursor.uses)&&Number.isFinite(cursor.last)){
    where.push(`(${bucket}>? OR (${bucket}=? AND COALESCE(a.use_count,0)>?) OR (${bucket}=? AND COALESCE(a.use_count,0)=? AND ${last}>?) OR (${bucket}=? AND COALESCE(a.use_count,0)=? AND ${last}=? AND a.id>?))`);
    values.push(cursor.bucket,cursor.bucket,cursor.uses,cursor.bucket,cursor.uses,cursor.last,cursor.bucket,cursor.uses,cursor.last,cursor.id);
  }
  const rows=await env.DB.prepare(`SELECT a.id,a.name,a.universe,a.subject,a.kind,a.tags,a.use_count,a.last_used_at FROM assets a LEFT JOIN v2_asset_search_index si ON si.asset_id=a.id WHERE ${where.join(" AND ")} ORDER BY ${bucket} ASC,COALESCE(a.use_count,0) ASC,${last} ASC,a.id ASC LIMIT ?`).bind(...values,limit+1).all<Record<string,unknown>>();
  const all=rows.results||[],hasMore=all.length>limit,page=all.slice(0,limit),lastRow=page[page.length-1];
  const items=page.map(row=>({asset_id:String(row.id),nome:String(row.name||""),universo:String(row.universe||""),subject:String(row.subject||""),tipo:String(row.kind||""),tags:parseTags(String(row.tags||"[]")),uses:Number(row.use_count||0),last_used_at:row.last_used_at==null?null:Number(row.last_used_at)}));
  const next_cursor=hasMore&&lastRow?encodeJsonCursor([Number(lastRow.use_count||0)===0?0:1,Number(lastRow.use_count||0),Number(lastRow.last_used_at||0),String(lastRow.id)]):null;
  return {status:"APPROVED",items,count:items.length,next_cursor,order:"NEVER_USED_THEN_LEAST_USED",normalization:"CASE_INSENSITIVE_ACCENT_INSENSITIVE_BASIC_TEXT"};
}

export async function findApprovedAssetsForGap(env:Env,input:{universe?:string;subject?:string;reference?:string;kind?:string;limit?:number}){
  await syncAssetSearchIndex(env);
  const universe=normalizeSearchText(input.universe),subject=normalizeSearchText(input.subject),reference=normalizeSearchText(input.reference),kind=normalizeSearchText(input.kind),limit=Math.max(1,Math.min(Number(input.limit||5),20));
  const where=["a.status='Aprovado'"];const values:unknown[]=[];
  if(universe){where.push("si.universe_norm=?");values.push(universe);}
  if(kind){where.push("si.kind_norm=?");values.push(kind);}
  const semantic=subject||reference;
  if(semantic){where.push("(si.subject_norm LIKE ? OR si.name_norm LIKE ? OR si.tags_norm LIKE ?)");const like=`%${semantic}%`;values.push(like,like,like);}
  const result=await env.DB.prepare(`SELECT a.id,a.name,a.universe,a.subject,a.kind,a.tags,a.use_count,a.last_used_at FROM assets a LEFT JOIN v2_asset_search_index si ON si.asset_id=a.id WHERE ${where.join(" AND ")} ORDER BY CASE WHEN COALESCE(a.use_count,0)=0 THEN 0 ELSE 1 END,COALESCE(a.use_count,0),COALESCE(a.last_used_at,0),a.id LIMIT ?`).bind(...values,limit).all<Record<string,unknown>>();
  return (result.results||[]).map(row=>({asset_id:String(row.id),nome:String(row.name||""),universo:String(row.universe||""),subject:String(row.subject||""),tipo:String(row.kind||""),tags:parseTags(String(row.tags||"[]")),uses:Number(row.use_count||0),last_used_at:row.last_used_at==null?null:Number(row.last_used_at)}));
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
