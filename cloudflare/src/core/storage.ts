import type { Env } from "../types";
import { validSignedCandidateRequest, validSignedFileRequest, validSignedSupervisorCandidateRequest } from "./auth";

function writeR2HttpMetadata(object:R2Object|R2ObjectBody,headers:Headers){
  if ("writeHttpMetadata" in object) { object.writeHttpMetadata(headers); return; }
  const meta=(object.httpMetadata||{}) as {contentType?:string;contentLanguage?:string;contentDisposition?:string;contentEncoding?:string;cacheControl?:string};
  if(meta.contentType) headers.set("content-type",meta.contentType);
  if(meta.contentLanguage) headers.set("content-language",meta.contentLanguage);
  if(meta.contentDisposition) headers.set("content-disposition",meta.contentDisposition);
  if(meta.contentEncoding) headers.set("content-encoding",meta.contentEncoding);
  if(meta.cacheControl) headers.set("cache-control",meta.cacheControl);
}

export async function serveFile(request: Request, assetId: string, env: Env) {
  if (!(await validSignedFileRequest(request, assetId, env))) return new Response("Forbidden", { status: 403 });
  const row = await env.DB.prepare("SELECT r2_key,mime_type,original_name,name FROM assets WHERE id = ?").bind(assetId).first<{ r2_key: string; mime_type: string | null; original_name?:string|null; name?:string|null }>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = request.method === "HEAD" ? await env.MEDIA.head(row.r2_key) : await env.MEDIA.get(row.r2_key);
  if (!object) return new Response("Object missing", { status: 404 });
  const headers = new Headers();
  writeR2HttpMetadata(object,headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=900");
  headers.set("x-content-type-options", "nosniff");
  if (row.mime_type) headers.set("content-type", row.mime_type);
  if(new URL(request.url).searchParams.get("mode")==="download") headers.set("content-disposition",`attachment; filename="${String(row.original_name||row.name||assetId).replace(/[\\/:*?"<>|\x00-\x1f]+/g,"-")}"`);
  return new Response(request.method === "HEAD" ? null : (object as R2ObjectBody).body, { headers });
}

export async function r2Inventory(request: Request, env: Env) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 1000));
  const cursor = url.searchParams.get("cursor") || undefined;
  const prefix = url.searchParams.get("prefix") || undefined;
  const result = await env.MEDIA.list({ limit, cursor, prefix, include: ["httpMetadata", "customMetadata"] });
  return {
    objects: result.objects.map(object => ({ key: object.key, size: object.size, etag: object.httpEtag, uploaded: object.uploaded.toISOString() })),
    truncated: result.truncated,
    cursor: result.truncated ? result.cursor : null,
  };
}

export async function integritySample(env: Env, limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const result = await env.DB.prepare("SELECT id,r2_key FROM assets ORDER BY updated_at DESC LIMIT ?").bind(safeLimit).all<{ id: string; r2_key: string }>();
  const rows = result.results || [];
  const checked = await Promise.all(rows.map(async row => ({ id: row.id, r2Key: row.r2_key, exists: Boolean(await env.MEDIA.head(row.r2_key)) })));
  const missing = checked.filter(item => !item.exists);
  return { checked: checked.length, present: checked.length - missing.length, missing: missing.length, missingItems: missing };
}

export async function serveCandidateFile(request: Request, candidateId: string, env: Env) {
  if (!(await validSignedCandidateRequest(request, candidateId, env))) return new Response("Forbidden", { status: 403 });
  const row = await env.DB.prepare("SELECT r2_key,mime_type FROM v2_ingest_candidates WHERE id=? AND r2_key IS NOT NULL").bind(candidateId).first<{ r2_key: string; mime_type: string | null }>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = request.method === "HEAD" ? await env.MEDIA.head(row.r2_key) : await env.MEDIA.get(row.r2_key);
  if (!object) return new Response("Object missing", { status: 404 });
  const headers = new Headers();
  writeR2HttpMetadata(object,headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=900");
  headers.set("x-content-type-options", "nosniff");
  if (row.mime_type) headers.set("content-type", row.mime_type);
  if(new URL(request.url).searchParams.get("mode")==="download") headers.set("content-disposition",`attachment; filename="${candidateId}"`);
  return new Response(request.method === "HEAD" ? null : (object as R2ObjectBody).body, { headers });
}

export async function serveSupervisorCandidateFile(request: Request, candidateId: string, env: Env) {
  if (!(await validSignedSupervisorCandidateRequest(request, candidateId, env))) return new Response("Forbidden", { status: 403 });
  const row = await env.DB.prepare("SELECT f.r2_key,f.mime_type FROM supervisor_project_candidates c JOIN materialization_files f ON f.id=c.materialization_file_id WHERE c.id=?").bind(candidateId).first<{ r2_key: string; mime_type: string | null }>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = request.method === "HEAD" ? await env.MEDIA.head(row.r2_key) : await env.MEDIA.get(row.r2_key);
  if (!object) return new Response("Object missing", { status: 404 });
  const headers = new Headers(); writeR2HttpMetadata(object,headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "private, max-age=900"); headers.set("x-content-type-options", "nosniff"); if (row.mime_type) headers.set("content-type", row.mime_type);
  return new Response(request.method === "HEAD" ? null : (object as R2ObjectBody).body, { headers });
}
