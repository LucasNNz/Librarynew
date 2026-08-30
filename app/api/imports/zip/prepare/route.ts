import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ error:"CORE_NOT_CONFIGURED" }, { status:503 });
  const body = await request.text();
  const response = await coreFetch("/imports/zip/prepare", { method:"POST", headers:{ "content-type":"application/json" }, body });
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":response.headers.get("content-type") || "application/json", "cache-control":"no-store" } });
}
