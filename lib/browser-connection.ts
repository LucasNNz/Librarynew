"use client";

export type BrowserConnection = {
  version: 1;
  coreUrl: string;
  appKey: string;
  accountId: string;
  workerName: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  r2BucketName: string;
  queueName: string;
  dlqName: string;
  savedAt: number;
};

const STORAGE_KEY = "corvo-library-v2:connection:v1";

export function readBrowserConnection(): BrowserConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowserConnection;
    if (!parsed?.coreUrl || !parsed?.appKey) return null;
    return parsed;
  } catch { return null; }
}

export function saveBrowserConnection(connection: BrowserConnection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function clearBrowserConnection() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function shouldProxy(value: string) {
  return value.startsWith("/api/")
    && !value.startsWith("/api/setup/")
    && !value.startsWith("/api/core-proxy/");
}

export function installCorvoFetchBridge() {
  if (typeof window === "undefined") return () => undefined;
  const nativeFetch = window.fetch.bind(window);
  const patched: typeof window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const connection = readBrowserConnection();
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
    if (!connection || !shouldProxy(raw)) return nativeFetch(input, init);
    const path = raw.slice(4); // /api/assets -> /assets
    const headers = new Headers(init?.headers);
    headers.set("x-corvo-app-key", connection.appKey);
    headers.set("x-corvo-core-url", connection.coreUrl);
    headers.set("accept", headers.get("accept") || "application/json");
    // Keep browser traffic same-origin. The server route forwards the request to
    // the saved Worker, avoiding CORS/preflight failures and opaque
    // `Failed to fetch` errors from older Core releases.
    return nativeFetch(`/api/core-proxy${path}`, { ...init, headers, cache: "no-store" });
  };
  window.fetch = patched;
  return () => { if (window.fetch === patched) window.fetch = nativeFetch; };
}
