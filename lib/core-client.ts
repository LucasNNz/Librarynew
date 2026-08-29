const coreUrl = () => process.env.CORVO_CORE_URL?.replace(/\/$/, "") || "";
const internalKey = () => process.env.CORVO_INTERNAL_KEY || "";

export type CoreHealth = {
  ok: boolean;
  service?: string;
  version?: string;
  d1?: "ok" | "error" | "unknown";
  r2?: "ok" | "error" | "unknown";
  queue?: "ok" | "error" | "unknown";
  signing?: "ok" | "error" | "unknown";
  error?: string;
  infrastructure?: { initialized?: boolean; profile?: Record<string, unknown> | null };
};

export function coreConfigured() {
  return Boolean(coreUrl() && internalKey());
}

export async function coreFetch(path: string, init: RequestInit = {}) {
  if (!coreConfigured()) {
    throw new Error("CORVO_CORE_NOT_CONFIGURED");
  }

  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-corvo-internal-key", internalKey());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${coreUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  return response;
}

export async function getCoreHealth(): Promise<CoreHealth> {
  if (!coreConfigured()) return { ok: false, d1: "unknown", r2: "unknown", queue: "unknown", error: "NOT_CONFIGURED" };
  try {
    const response = await coreFetch("/health");
    const value = (await response.json()) as CoreHealth;
    return response.ok ? value : { ...value, ok: false, error: value.error || `HTTP_${response.status}` };
  } catch (error) {
    return { ok: false, d1: "unknown", r2: "unknown", queue: "unknown", error: error instanceof Error ? error.message : "UNAVAILABLE" };
  }
}
