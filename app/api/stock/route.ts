import { coreFetch } from "../../../lib/core-client";
export async function GET(){const r=await coreFetch('/stock');return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});}
