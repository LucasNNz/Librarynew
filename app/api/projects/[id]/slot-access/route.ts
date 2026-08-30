import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../../lib/core-client";
type Ctx={params:Promise<{id:string}>};
async function proxy(request:NextRequest,context:Ctx){if(!coreConfigured())return NextResponse.json({error:"CORE_NOT_CONFIGURED"},{status:503});const {id}=await context.params;const r=await coreFetch(`/projects/${encodeURIComponent(id)}/slot-access`,{method:request.method,body:request.method==="POST"?await request.text():undefined});return new NextResponse(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
export const GET=proxy;export const POST=proxy;
