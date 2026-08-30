import type { Env } from "../types";
import { validSignedThumbnailRequest } from "./auth";
import { safeRemoteUrl } from "./net";

const THUMB_WIDTH = 420;
const THUMB_QUALITY = 74;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

function imageResponse(body: BodyInit | null, contentType: string, sizeBytes?: number) {
  const headers = new Headers({
    "content-type": contentType || "image/webp",
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "x-corvo-thumbnail": "1",
  });
  if (Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > 0) headers.set("content-length", String(sizeBytes));
  return new Response(body, { status: 200, headers });
}

async function cachedThumbnail(env: Env, key: string) {
  const object = await env.MEDIA.get(key);
  if (!object) return null;
  const headers = new Headers({
    "content-type": String((object.httpMetadata as { contentType?: string } | undefined)?.contentType || "image/webp"),
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "x-corvo-thumbnail": "R2_HIT",
  });
  return new Response(object.body, { headers });
}

async function generateFromSource(env: Env, assetId: string, sourceUrl: string, thumbKey: string) {
  const remote = safeRemoteUrl(sourceUrl);
  if (!remote) return null;
  try {
    const init = {
      redirect: "follow",
      headers: { "user-agent": "CorvoLibraryV2-Thumbnail/1.0" },
      signal: AbortSignal.timeout(12_000),
      cf: { image: { width: THUMB_WIDTH, fit: "scale-down", format: "webp", quality: THUMB_QUALITY, metadata: "none" } },
    } as RequestInit & { cf: { image: Record<string, unknown> } };
    const response = await fetch(remote.toString(), init);
    if (!response.ok || !response.body) return null;
    const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_THUMB_BYTES) return null;
    await env.MEDIA.put(thumbKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: { assetId, sourceUrl: remote.toString(), width: String(THUMB_WIDTH), quality: String(THUMB_QUALITY) },
    });
    return imageResponse(bytes, contentType, bytes.byteLength);
  } catch {
    return null;
  }
}

export async function serveAssetThumbnail(request: Request, assetId: string, env: Env) {
  if (!(await validSignedThumbnailRequest(request, assetId, env))) return new Response("FORBIDDEN", { status: 403 });
  const row = await env.DB.prepare("SELECT id,r2_key,source_url,mime_type FROM assets WHERE id=?").bind(assetId).first<{id:string;r2_key:string;source_url:string|null;mime_type:string|null}>();
  if (!row) return new Response("NOT_FOUND", { status: 404 });
  if (!String(row.mime_type || "").toLowerCase().startsWith("image/")) return new Response("NOT_AN_IMAGE", { status: 415 });

  const thumbKey = `thumbs/assets/${assetId}.webp`;
  const cached = await cachedThumbnail(env, thumbKey);
  if (cached) return cached;

  if (row.source_url) {
    const generated = await generateFromSource(env, assetId, row.source_url, thumbKey);
    if (generated) return generated;
  }

  // Legacy/imported assets may not have a usable source URL. In that case we
  // preserve correctness and serve the original object as a temporary fallback.
  // New/remote assets converge to the dedicated R2 thumbnail on first view.
  const original = await env.MEDIA.get(String(row.r2_key || ""));
  if (!original) return new Response("OBJECT_MISSING", { status: 404 });
  const headers = new Headers({
    "content-type": String((original.httpMetadata as { contentType?: string } | undefined)?.contentType || row.mime_type || "application/octet-stream"),
    "cache-control": "public, max-age=900, stale-while-revalidate=3600",
    "x-corvo-thumbnail": "ORIGINAL_FALLBACK",
  });
  return new Response(original.body, { headers });
}
