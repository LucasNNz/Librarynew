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

export type BrowserConnectionProfile = {
  id: string;
  label: string;
  connection: BrowserConnection;
  createdAt: number;
  updatedAt: number;
};

type BrowserConnectionStoreV2 = {
  version: 2;
  activeId: string | null;
  profiles: Record<string, BrowserConnectionProfile>;
};

const LEGACY_STORAGE_KEY = "corvo-library-v2:connection:v1";
const STORE_KEY = "corvo-library-v2:connections:v2";

function normalizeCoreUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function validConnection(value: unknown): value is BrowserConnection {
  const c = value as BrowserConnection | null;
  return Boolean(c?.coreUrl && c?.appKey);
}

function profileId(connection: BrowserConnection) {
  // A Core URL uniquely identifies one Corvo installation from the browser's
  // point of view. Rotating a device token updates the same profile instead of
  // creating duplicates.
  return normalizeCoreUrl(connection.coreUrl);
}

function profileLabel(connection: BrowserConnection) {
  const worker = String(connection.workerName || "Corvo Core").trim();
  const account = String(connection.accountId || "").trim();
  return account ? `${worker} · ${account.slice(-6)}` : worker;
}

function emptyStore(): BrowserConnectionStoreV2 {
  return { version: 2, activeId: null, profiles: {} };
}

function writeLegacyMirror(connection: BrowserConnection | null) {
  if (typeof window === "undefined") return;
  if (connection) window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(connection));
  else window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function persistStore(store: BrowserConnectionStoreV2) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  const active = store.activeId ? store.profiles[store.activeId]?.connection || null : null;
  // Keep a mirror for backward compatibility with previous releases. New code
  // reads v2, but rolling back the frontend still opens the currently selected
  // installation rather than losing access.
  writeLegacyMirror(active);
}

function loadStore(): BrowserConnectionStoreV2 {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BrowserConnectionStoreV2;
      if (parsed?.version === 2 && parsed.profiles && typeof parsed.profiles === "object") {
        const profiles: Record<string, BrowserConnectionProfile> = {};
        for (const [id, item] of Object.entries(parsed.profiles)) {
          if (!item || !validConnection(item.connection)) continue;
          const canonicalId = profileId(item.connection) || id;
          profiles[canonicalId] = {
            id: canonicalId,
            label: String(item.label || profileLabel(item.connection)),
            connection: item.connection,
            createdAt: Number(item.createdAt || item.connection.savedAt || Date.now()),
            updatedAt: Number(item.updatedAt || item.connection.savedAt || Date.now()),
          };
        }
        let activeId = parsed.activeId && profiles[parsed.activeId] ? parsed.activeId : null;
        if (!activeId) activeId = Object.values(profiles).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id || null;
        const normalized: BrowserConnectionStoreV2 = { version:2, activeId, profiles };
        // Repair old/malformed v2 stores and refresh the v1 compatibility mirror.
        persistStore(normalized);
        return normalized;
      }
    }
  } catch {}

  // Automatic migration from the single-profile v1 store. Nothing is deleted:
  // the v1 key becomes a mirror of whichever v2 profile is active.
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const connection = JSON.parse(raw) as BrowserConnection;
      if (validConnection(connection)) {
        const id = profileId(connection);
        const stamp = Number(connection.savedAt || Date.now());
        const store: BrowserConnectionStoreV2 = {
          version:2,
          activeId:id,
          profiles:{[id]:{id,label:profileLabel(connection),connection,createdAt:stamp,updatedAt:stamp}},
        };
        persistStore(store);
        return store;
      }
    }
  } catch {}
  return emptyStore();
}

export function listBrowserConnections(): BrowserConnectionProfile[] {
  return Object.values(loadStore().profiles).sort((a,b)=>b.updatedAt-a.updatedAt || a.label.localeCompare(b.label));
}

export function readBrowserConnection(): BrowserConnection | null {
  const store = loadStore();
  return store.activeId ? store.profiles[store.activeId]?.connection || null : null;
}

export function readActiveBrowserConnectionProfile(): BrowserConnectionProfile | null {
  const store = loadStore();
  return store.activeId ? store.profiles[store.activeId] || null : null;
}

export function saveBrowserConnection(connection: BrowserConnection) {
  if (typeof window === "undefined" || !validConnection(connection)) return;
  const store = loadStore();
  const id = profileId(connection);
  const previous = store.profiles[id];
  const now = Date.now();
  store.profiles[id] = {
    id,
    label: previous?.label || profileLabel(connection),
    connection,
    createdAt: previous?.createdAt || Number(connection.savedAt || now),
    updatedAt: now,
  };
  store.activeId = id;
  persistStore(store);
}

export function setActiveBrowserConnection(id: string): BrowserConnection | null {
  if (typeof window === "undefined") return null;
  const store = loadStore();
  const next = store.profiles[id];
  if (!next) return null;
  store.activeId = id;
  next.updatedAt = Date.now();
  persistStore(store);
  return next.connection;
}

export function renameBrowserConnection(id: string, label: string) {
  if (typeof window === "undefined") return false;
  const store = loadStore();
  const profile = store.profiles[id];
  const clean = String(label || "").trim().slice(0,80);
  if (!profile || !clean) return false;
  profile.label = clean;
  profile.updatedAt = Date.now();
  persistStore(store);
  return true;
}

export function removeBrowserConnection(id: string): BrowserConnection | null {
  if (typeof window === "undefined") return null;
  const store = loadStore();
  if (!store.profiles[id]) return readBrowserConnection();
  delete store.profiles[id];
  if (store.activeId === id) {
    store.activeId = Object.values(store.profiles).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id || null;
  }
  persistStore(store);
  return store.activeId ? store.profiles[store.activeId]?.connection || null : null;
}

export function clearBrowserConnection() {
  const active = readActiveBrowserConnectionProfile();
  if (!active) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return;
  }
  removeBrowserConnection(active.id);
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
    return nativeFetch(`/api/core-proxy${path}`, { ...init, headers, cache: "no-store" });
  };
  window.fetch = patched;
  return () => { if (window.fetch === patched) window.fetch = nativeFetch; };
}
