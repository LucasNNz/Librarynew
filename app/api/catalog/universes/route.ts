import { NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!coreConfigured()) return NextResponse.json({ universes:[], state:"CORE_NOT_CONFIGURED" });
  const response = await coreFetch("/catalog/universes");
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":"application/json", "cache-control":"no-store" } });
}
