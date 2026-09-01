/**
 * Normalizes public signed-media delivery for browsers, security scanners and
 * MCP URL probes. Many clients issue HEAD before GET; HEAD must resolve through
 * the exact same signed handler without returning the file body.
 */
export async function publicMediaResponse(
  request: Request,
  route: string,
  coreVersion: string,
  producer: () => Promise<Response>,
) {
  const raw = await producer();
  const headers = new Headers(raw.headers);
  headers.set("x-corvo-public-media-route", route);
  headers.set("x-corvo-core-version", coreVersion);
  if (request.method === "HEAD") {
    return new Response(null, { status: raw.status, statusText: raw.statusText, headers });
  }
  for (const [key, value] of headers) raw.headers.set(key, value);
  return raw;
}
