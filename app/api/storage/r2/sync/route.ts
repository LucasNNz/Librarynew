import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ error:"CORE_NOT_CONFIGURED" }, { status:503 });
  const body = await request.text();
  const response = await coreFetch("/storage/sync-r2", { method:"POST", headers:{ "content-type":"application/json" }, body });
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":response.headers.get("content-type") || "application/json", "cache-control":"no-store" } });
}

export async function GET(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ error:"CORE_NOT_CONFIGURED" }, { status:503 });
  const query = request.nextUrl.searchParams.toString();
  const response = await coreFetch(`/storage/sync-r2${query ? `?${query}` : ""}`);
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":response.headers.get("content-type") || "application/json", "cache-control":"no-store" } });
}
