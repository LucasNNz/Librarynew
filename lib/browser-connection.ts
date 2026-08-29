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
  return value.startsWith("/api/") && !value.startsWith("/api/setup/");
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
    headers.set("accept", headers.get("accept") || "application/json");
    return nativeFetch(`${connection.coreUrl.replace(/\/$/, "")}${path}`, { ...init, headers, cache: "no-store" });
  };
  window.fetch = patched;
  return () => { if (window.fetch === patched) window.fetch = nativeFetch; };
}
