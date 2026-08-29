import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";

export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json({ initialized:false, coreConfigured:false, profile:null, bindings:null, events:[], error:"CORVO_CORE_NOT_CONFIGURED" }, { status:200, headers:{"cache-control":"no-store"} });
}

export async function GET() {
  if (!coreConfigured()) return unavailable();
  const response = await coreFetch("/infrastructure/config");
  return new NextResponse(await response.text(), { status:response.status, headers:{"content-type":"application/json","cache-control":"no-store"} });
}

export async function POST(request:NextRequest) {
  if (!coreConfigured()) return NextResponse.json({error:"CORVO_CORE_NOT_CONFIGURED"},{status:409});
  const response = await coreFetch("/infrastructure/config", { method:"POST", body:await request.text(), headers:{"content-type":"application/json"} });
  return new NextResponse(await response.text(), { status:response.status, headers:{"content-type":"application/json","cache-control":"no-store"} });
}

export async function PATCH(request:NextRequest) {
  if (!coreConfigured()) return NextResponse.json({error:"CORVO_CORE_NOT_CONFIGURED"},{status:409});
  const response = await coreFetch("/infrastructure/config", { method:"PATCH", body:await request.text(), headers:{"content-type":"application/json"} });
  return new NextResponse(await response.text(), { status:response.status, headers:{"content-type":"application/json","cache-control":"no-store"} });
}
