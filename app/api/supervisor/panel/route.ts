import { NextRequest } from "next/server";
import { coreFetch } from "../../../../lib/core-client";
export async function GET(request:NextRequest){const u=new URL(request.url);const qs=u.searchParams.toString();const r=await coreFetch(`/supervisor/panel${qs?`?${qs}`:""}`);return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});}
