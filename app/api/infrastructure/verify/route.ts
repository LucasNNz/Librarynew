import { NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../../lib/core-client";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!coreConfigured()) return NextResponse.json({error:"CORVO_CORE_NOT_CONFIGURED"},{status:409});
  const response = await coreFetch("/infrastructure/verify", { method:"POST" });
  return new NextResponse(await response.text(), { status:response.status, headers:{"content-type":"application/json","cache-control":"no-store"} });
}
