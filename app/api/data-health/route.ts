import { NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../lib/core-client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!coreConfigured()) return NextResponse.json({ ok:false,state:"CORE_NOT_CONFIGURED",catalog:{assetsMissingR2Key:0,duplicateAssetR2Keys:0},v2Orphans:0,activeHistoricalOrphans:0,historical:{},activeHistoricalRisk:{},v2:{} });
  const response=await coreFetch("/data-health");
  return new NextResponse(await response.text(),{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
