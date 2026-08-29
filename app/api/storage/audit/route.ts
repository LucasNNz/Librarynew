import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!coreConfigured()) return NextResponse.json({ audit:null,state:"CORE_NOT_CONFIGURED" });
  const response=await coreFetch("/storage/audit/latest");
  return new NextResponse(await response.text(),{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
export async function POST(request:NextRequest) {
  if (!coreConfigured()) return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const maxObjects=request.nextUrl.searchParams.get("maxObjects")||"10000";
  const response=await coreFetch(`/storage/audit?maxObjects=${encodeURIComponent(maxObjects)}`,{method:"POST"});
  return new NextResponse(await response.text(),{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
