export const nowMs = () => Date.now();
export const nowIso = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;

export function safeFilenameFromUrl(value: string, fallback: string) {
  try {
    const pathname = new URL(value).pathname;
    const candidate = decodeURIComponent(pathname.split("/").pop() || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return candidate || fallback;
  } catch {
    return fallback;
  }
}
