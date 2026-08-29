import { NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export const dynamic="force-dynamic";
export async function GET(){if(!coreConfigured())return NextResponse.json({ok:false,state:"CORE_NOT_CONFIGURED"});const r=await coreFetch("/workers/health");return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
