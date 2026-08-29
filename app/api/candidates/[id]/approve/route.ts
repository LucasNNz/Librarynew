import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";
export async function POST(_request: NextRequest, context: { params: Promise<{ id:string }> }) {
  if (!coreConfigured()) return NextResponse.json({ error:"CORE_NOT_CONFIGURED" }, { status:503 });
  const { id } = await context.params;
  const response = await coreFetch(`/candidates/${encodeURIComponent(id)}/approve`, { method:"POST" });
  return new NextResponse(await response.text(), { status:response.status, headers:{ "content-type":"application/json", "cache-control":"no-store" } });
}
