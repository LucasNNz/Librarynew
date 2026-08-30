import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const {id}=await context.params;
  const limit=request.nextUrl.searchParams.get("limit")||"500";
  const r=await coreFetch(`/projects/${encodeURIComponent(id)}/artifacts?limit=${encodeURIComponent(limit)}`);
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
