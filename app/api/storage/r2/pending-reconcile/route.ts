import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  if(!coreConfigured())return NextResponse.json({pending:0,present:0,repairable:0,probable:0,unresolved:0,items:[],state:"CORE_NOT_CONFIGURED"});
  const qs=request.nextUrl.searchParams.toString();
  const r=await coreFetch(`/storage/r2/pending-reconcile${qs?`?${qs}`:""}`);
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
export async function POST(request:NextRequest){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const r=await coreFetch("/storage/r2/pending-reconcile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(await request.json())});
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
