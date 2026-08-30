import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

function allowedCoreUrl(value: string) {
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev")) && !local) {
    throw new Error("CORE_URL_NOT_ALLOWED");
  }
  if (url.username || url.password) throw new Error("CORE_URL_NOT_ALLOWED");
  return url;
}

function responseHeaders(upstream: Response) {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of ["content-type", "content-disposition", "etag", "last-modified", "location", "accept-ranges", "content-range", "x-corvo-cache", "x-corvo-fast-read", "x-corvo-duration-ms", "x-corvo-response-bytes", "x-corvo-route", "x-corvo-thumbnail"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext) {
  try {
    const coreUrl = request.headers.get("x-corvo-core-url")?.trim() || "";
    const appKey = request.headers.get("x-corvo-app-key")?.trim() || "";
    if (!coreUrl || !appKey) return NextResponse.json({ error: "CORE_CONNECTION_MISSING" }, { status: 400 });

    const base = allowedCoreUrl(coreUrl);
    const { path } = await context.params;
    const target = new URL(`/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, base.origin);
    const headers = new Headers();
    headers.set("x-corvo-app-key", appKey);
    for (const name of ["accept", "content-type", "range", "if-match", "if-none-match"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "UNKNOWN";
    const status = detail === "CORE_URL_NOT_ALLOWED" || detail === "Invalid URL" ? 400 : 502;
    return NextResponse.json({ error: status === 400 ? "CORE_URL_INVALID" : "CORE_PROXY_UNREACHABLE", detail }, { status });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
