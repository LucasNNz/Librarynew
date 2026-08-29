import { NextRequest, NextResponse } from "next/server";
import { coreConfigured, coreFetch } from "../../../lib/core-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!coreConfigured()) return NextResponse.json({ items: [], total: 0, nextCursor: null, state: "CORE_NOT_CONFIGURED" });
  const params = request.nextUrl.searchParams.toString();
  const response = await coreFetch(`/assets${params ? `?${params}` : ""}`);
  const body = await response.text();
  return new NextResponse(body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
}
