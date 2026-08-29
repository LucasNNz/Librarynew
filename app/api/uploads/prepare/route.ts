import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";
export async function POST(request:NextRequest){if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});const body=await request.text();const r=await coreFetch("/uploads/prepare",{method:"POST",body});return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
