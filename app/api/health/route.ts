import { NextResponse } from "next/server";
import { coreConfigured, getCoreHealth } from "../../../lib/core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const core = await getCoreHealth();
  return NextResponse.json({
    app: "ok",
    version: "0.20.45",
    architecture: "CLOUDFLARE_CORE",
    coreConfigured: coreConfigured(),
    core,
  }, { headers: { "cache-control": "no-store" } });
}
