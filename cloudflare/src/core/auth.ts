import type { Env } from "../types";

const DEVICE_TOKEN_PREFIX = "corvo-device-v1";
const DEVICE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeBase64UrlText(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function internalKey(env: Env) {
  const key = String(env.CORVO_INTERNAL_KEY || "").trim();
  if (!key) throw new Error("CORVO_INTERNAL_KEY_MISSING");
  return key;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

async function validBrowserDeviceToken(token: string, env: Env) {
  if (!token.startsWith(`${DEVICE_TOKEN_PREFIX}.`)) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [prefix, encoded, supplied] = parts;
  if (prefix !== DEVICE_TOKEN_PREFIX || !encoded || !supplied) return false;
  let payload: { v?: number; d?: string; iat?: number; exp?: number };
  try { payload = JSON.parse(decodeBase64UrlText(encoded)) as typeof payload; } catch { return false; }
  const now = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || !payload.d || !Number.isFinite(payload.exp) || Number(payload.exp) < now) return false;
  const expected = await hmac(`${prefix}.${encoded}`, internalKey(env));
  return safeEqual(supplied, expected);
}

export async function createBrowserDeviceToken(env: Env, label?: string) {
  const deviceId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const payload = { v:1, d:deviceId, iat:now, exp:now + DEVICE_TOKEN_TTL_SECONDS, label:String(label || "browser").slice(0,80) };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${DEVICE_TOKEN_PREFIX}.${encoded}`;
  const signature = await hmac(message, internalKey(env));
  return { token:`${message}.${signature}`, deviceId, issuedAt:payload.iat, expiresAt:payload.exp, kind:"DEVICE_TOKEN_V1" as const };
}

export async function authorized(request: Request, env: Env) {
  const internal = request.headers.get("x-corvo-internal-key") || "";
  const app = request.headers.get("x-corvo-app-key") || "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (env.CORVO_INTERNAL_KEY && (internal === env.CORVO_INTERNAL_KEY || bearer === env.CORVO_INTERNAL_KEY)) return true;
  if (env.CORVO_APP_KEY && (app === env.CORVO_APP_KEY || bearer === env.CORVO_APP_KEY)) return true;
  const candidate = app || bearer;
  if (candidate && env.CORVO_INTERNAL_KEY && await validBrowserDeviceToken(candidate, env)) return true;
  return false;
}

export function validControlPairingRequest(request: Request, env: Env) {
  const supplied = request.headers.get("x-corvo-control-token") || "";
  const expected = String(env.CLOUDFLARE_CONTROL_TOKEN || "");
  return Boolean(supplied && expected && safeEqual(supplied, expected));
}

function signingKey(env: Env) {
  if (!env.CORVO_SIGNING_KEY) throw new Error("CORVO_SIGNING_KEY_MISSING");
  return env.CORVO_SIGNING_KEY;
}

async function createSignedUrl(request: Request, subject: string, path: string, env: Env, ttlSeconds = 900) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await hmac(`${subject}.${expires}`, signingKey(env));
  const origin = new URL(request.url).origin;
  return `${origin}${path}?exp=${expires}&sig=${encodeURIComponent(signature)}`;
}

async function validSignedRequest(request: Request, subject: string, env: Env) {
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp") || 0);
  const supplied = url.searchParams.get("sig") || "";
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !supplied) return false;
  const expected = await hmac(`${subject}.${exp}`, signingKey(env));
  return supplied === expected;
}

export function createSignedFileUrl(request: Request, assetId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `asset:${assetId}`, `/files/${encodeURIComponent(assetId)}`, env, ttlSeconds);
}

export function validSignedFileRequest(request: Request, assetId: string, env: Env) {
  return validSignedRequest(request, `asset:${assetId}`, env);
}

export function createSignedThumbnailUrl(request: Request, assetId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `thumb:${assetId}`, `/thumbs/${encodeURIComponent(assetId)}`, env, ttlSeconds);
}

export function validSignedThumbnailRequest(request: Request, assetId: string, env: Env) {
  return validSignedRequest(request, `thumb:${assetId}`, env);
}

export function createSignedCandidateUrl(request: Request, candidateId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `candidate:${candidateId}`, `/candidate-files/${encodeURIComponent(candidateId)}`, env, ttlSeconds);
}

export function validSignedCandidateRequest(request: Request, candidateId: string, env: Env) {
  return validSignedRequest(request, `candidate:${candidateId}`, env);
}

export function createSignedSupervisorCandidateUrl(request: Request, candidateId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `supervisor-candidate:${candidateId}`, `/supervisor-candidate-files/${encodeURIComponent(candidateId)}`, env, ttlSeconds);
}

export function validSignedSupervisorCandidateRequest(request: Request, candidateId: string, env: Env) {
  return validSignedRequest(request, `supervisor-candidate:${candidateId}`, env);
}


export function createSignedUploadUrl(request: Request, uploadId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `upload:${uploadId}`, `/uploads/${encodeURIComponent(uploadId)}`, env, ttlSeconds);
}

export function validSignedUploadRequest(request: Request, uploadId: string, env: Env) {
  return validSignedRequest(request, `upload:${uploadId}`, env);
}

export function createSignedPackageUrl(request: Request, packageId: string, env: Env, ttlSeconds = 1800) {
  return createSignedUrl(request, `package:${packageId}`, `/package-files/${encodeURIComponent(packageId)}`, env, ttlSeconds);
}

export function validSignedPackageRequest(request: Request, packageId: string, env: Env) {
  return validSignedRequest(request, `package:${packageId}`, env);
}

export function createSignedProjectFileUrl(request: Request, fileId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `project-file:${fileId}`, `/project-files/${encodeURIComponent(fileId)}`, env, ttlSeconds);
}

export function validSignedProjectFileRequest(request: Request, fileId: string, env: Env) {
  return validSignedRequest(request, `project-file:${fileId}`, env);
}

export function createSignedQaExportUrl(request: Request, exportId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `qa-export:${exportId}`, `/qa-exports/${encodeURIComponent(exportId)}`, env, ttlSeconds);
}

export function validSignedQaExportRequest(request: Request, exportId: string, env: Env) {
  return validSignedRequest(request, `qa-export:${exportId}`, env);
}

export function createSignedProjectMediaUrl(request: Request, mediaId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `project-media:${mediaId}`, `/project-media/${encodeURIComponent(mediaId)}`, env, ttlSeconds);
}

export function validSignedProjectMediaRequest(request: Request, mediaId: string, env: Env) {
  return validSignedRequest(request, `project-media:${mediaId}`, env);
}

export function createSignedAssetExportUrl(request: Request, exportId: string, env: Env, ttlSeconds = 1800) {
  return createSignedUrl(request, `asset-export:${exportId}`, `/asset-exports/${encodeURIComponent(exportId)}`, env, ttlSeconds);
}

export function validSignedAssetExportRequest(request: Request, exportId: string, env: Env) {
  return validSignedRequest(request, `asset-export:${exportId}`, env);
}
