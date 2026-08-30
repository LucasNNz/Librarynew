import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export async function POST(request:NextRequest){
  if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});
  const r=await coreFetch("/projects/bulk",{method:"POST",body:await request.text()});
  return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
