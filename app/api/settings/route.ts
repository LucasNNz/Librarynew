import { NextRequest } from "next/server";
import { coreFetch } from "../../../lib/core-client";
export async function GET(){const r=await coreFetch('/settings');return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});}
export async function PATCH(request:NextRequest){const r=await coreFetch('/settings',{method:'PATCH',body:await request.text(),headers:{'content-type':'application/json'}});return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});}
