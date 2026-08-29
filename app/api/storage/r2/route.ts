import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){if(!coreConfigured())return NextResponse.json({objects:[],truncated:false,cursor:null,state:"CORE_NOT_CONFIGURED"});const qs=request.nextUrl.searchParams.toString();const r=await coreFetch(`/storage/r2${qs?`?${qs}`:""}`);return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
