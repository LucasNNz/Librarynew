import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../lib/core-client";

export async function POST(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ error: "CORE_NOT_CONFIGURED" }, { status: 503 });
  const body = await request.text();
  const response = await coreFetch("/fast-push", { method: "POST", body });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
