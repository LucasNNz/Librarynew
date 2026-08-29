import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){if(!coreConfigured())return NextResponse.json({items:[],state:"CORE_NOT_CONFIGURED"});const q=request.nextUrl.searchParams.toString();const r=await coreFetch(`/materialization/host-health${q?`?${q}`:""}`);return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
