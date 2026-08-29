import type { Env } from "../types";

export function authorized(request: Request, env: Env) {
  const supplied = request.headers.get("x-corvo-internal-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return Boolean(env.CORVO_INTERNAL_KEY && supplied && supplied === env.CORVO_INTERNAL_KEY);
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

async function createSignedUrl(request: Request, subject: string, path: string, env: Env, ttlSeconds = 900) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await hmac(`${subject}.${expires}`, env.CORVO_INTERNAL_KEY);
  const origin = new URL(request.url).origin;
  return `${origin}${path}?exp=${expires}&sig=${encodeURIComponent(signature)}`;
}

async function validSignedRequest(request: Request, subject: string, env: Env) {
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp") || 0);
  const supplied = url.searchParams.get("sig") || "";
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !supplied) return false;
  const expected = await hmac(`${subject}.${exp}`, env.CORVO_INTERNAL_KEY);
  return supplied === expected;
}

export function createSignedFileUrl(request: Request, assetId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `asset:${assetId}`, `/files/${encodeURIComponent(assetId)}`, env, ttlSeconds);
}

export function validSignedFileRequest(request: Request, assetId: string, env: Env) {
  return validSignedRequest(request, `asset:${assetId}`, env);
}

export function createSignedCandidateUrl(request: Request, candidateId: string, env: Env, ttlSeconds = 900) {
  return createSignedUrl(request, `candidate:${candidateId}`, `/candidate-files/${encodeURIComponent(candidateId)}`, env, ttlSeconds);
}

export function validSignedCandidateRequest(request: Request, candidateId: string, env: Env) {
  return validSignedRequest(request, `candidate:${candidateId}`, env);
}
