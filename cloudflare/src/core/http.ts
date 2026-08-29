export function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-headers": "content-type,x-corvo-internal-key,authorization",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
}

export function withCors(response: Response, request: Request) {
  for (const [key, value] of Object.entries(corsHeaders(request))) response.headers.set(key, value);
  return response;
}
