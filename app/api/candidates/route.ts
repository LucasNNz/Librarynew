import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../lib/core-client";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ items:[], state:"CORE_NOT_CONFIGURED" });
  const params = request.nextUrl.searchParams.toString();
  const response = await coreFetch(`/candidates${params ? `?${params}` : ""}`);
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":"application/json", "cache-control":"no-store" } });
}
