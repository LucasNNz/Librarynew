import { coreFetch } from "../../../../lib/core-client";
export async function GET(){const r=await coreFetch('/policies/telemetry');return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});}
