/**
 * Server-side fallback only.
 *
 * Corvo Library V2 0.12 intentionally does not depend on hosting Environment
 * Variables to locate/authenticate the Core. Once configured, the browser
 * fetch bridge talks directly to the Worker using the persisted app key.
 * These helpers keep pre-configuration BFF routes deterministic instead of
 * silently falling back to a hidden provider configuration.
 */
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
  return false;
}

export async function coreFetch(_path: string, _init: RequestInit = {}): Promise<Response> {
  throw new Error("CORVO_BROWSER_DIRECT_REQUIRED");
}

export async function getCoreHealth(): Promise<CoreHealth> {
  return { ok: false, d1: "unknown", r2: "unknown", queue: "unknown", error: "NOT_CONFIGURED_IN_THIS_BROWSER" };
}
