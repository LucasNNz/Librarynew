import { NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!coreConfigured()) return NextResponse.json({ total:0, approved:0, pending:0, rejected:0, universes:0, bytes:0, uses:0, state:"CORE_NOT_CONFIGURED" });
  const response = await coreFetch("/catalog/stats");
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":"application/json", "cache-control":"no-store" } });
}
