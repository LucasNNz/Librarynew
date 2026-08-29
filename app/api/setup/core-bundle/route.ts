import { CORE_WORKER_BUNDLE, CORE_WORKER_BUNDLE_VERSION } from "../../../../lib/generated-core-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!CORE_WORKER_BUNDLE || CORE_WORKER_BUNDLE_VERSION === "UNBUILT") {
    return new Response("CORE_WORKER_BUNDLE_NOT_BUILT", { status: 503, headers: { "cache-control": "no-store" } });
  }
  return new Response(CORE_WORKER_BUNDLE, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-corvo-core-version": CORE_WORKER_BUNDLE_VERSION,
    },
  });
}
