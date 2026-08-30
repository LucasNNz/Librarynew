import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";

export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const {id}=await context.params;
  const ttl=request.nextUrl.searchParams.get("ttlMinutes")||"30";
  const r=await coreFetch(`/projects/${encodeURIComponent(id)}/final-exports?ttlMinutes=${encodeURIComponent(ttl)}`);
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}

export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const {id}=await context.params;
  const body=await request.text();
  const r=await coreFetch(`/projects/${encodeURIComponent(id)}/final-exports`,{method:"POST",headers:{"content-type":"application/json"},body:body||"{}"});
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
