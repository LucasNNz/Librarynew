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

export async function stableId(prefix: string, value: string, bytes = 10) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest).slice(0, Math.max(6, Math.min(bytes, 16)))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${prefix}-${hex}`;
}
