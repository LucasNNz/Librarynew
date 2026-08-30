import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../../lib/core-client";

export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const {id}=await context.params;
  const role=request.nextUrl.searchParams.get("role")||"REFERENCES";
  const version=request.nextUrl.searchParams.get("version");
  const query=new URLSearchParams({role}); if(version)query.set("version",version);
  const r=await coreFetch(`/projects/${encodeURIComponent(id)}/files/read?${query.toString()}`);
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
