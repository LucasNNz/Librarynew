import { NextRequest, NextResponse } from "next/server";
import { CORE_WORKER_BUNDLE, CORE_WORKER_BUNDLE_VERSION } from "../../../../../lib/generated-core-bundle";
import { putWorkerSecretWithToken, updateWorkerBundlePreservingBindings } from "../../../../../lib/cloudflare-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  apiToken?: string;
  accountId?: string;
  workerName?: string;
  coreUrl?: string;
  deviceLabel?: string;
};

function allowedCoreUrl(value: string) {
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev")) && !local) throw new Error("CORE_URL_NOT_ALLOWED");
  if (url.username || url.password) throw new Error("CORE_URL_NOT_ALLOWED");
  return url.origin;
}

async function probeVersion(coreUrl: string) {
  try {
    const response = await fetch(`${coreUrl}/version`, { cache:"no-store", signal:AbortSignal.timeout(12_000) });
    const value = await response.json().catch(()=>({})) as {version?:string;core_version?:string};
    return { ok:response.ok, version:String(value.core_version||value.version||"") };
  } catch { return {ok:false,version:""}; }
}

async function waitForVersion(coreUrl: string, version: string) {
  for (let attempt=0; attempt<30; attempt+=1) {
    if (attempt) await new Promise(resolve=>setTimeout(resolve,Math.min(2200,700+attempt*70)));
    const probe=await probeVersion(coreUrl);
    if (probe.ok && probe.version===version) return true;
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body=await request.json() as Body;
    const apiToken=String(body.apiToken||"").trim();
    const accountId=String(body.accountId||"").trim();
    const workerName=String(body.workerName||"").trim();
    const coreUrl=allowedCoreUrl(String(body.coreUrl||""));
    if(!apiToken) return NextResponse.json({error:"CLOUDFLARE_API_TOKEN_REQUIRED"},{status:400});
    if(!accountId) return NextResponse.json({error:"ACCOUNT_ID_REQUIRED"},{status:400});
    if(!workerName) return NextResponse.json({error:"WORKER_NAME_REQUIRED"},{status:400});
    if(!CORE_WORKER_BUNDLE||CORE_WORKER_BUNDLE_VERSION==="UNBUILT") return NextResponse.json({error:"CORE_WORKER_BUNDLE_NOT_BUILT"},{status:500});

    // Refresh only the control token. Do not rotate CORVO_APP_KEY,
    // CORVO_INTERNAL_KEY or CORVO_SIGNING_KEY: other PCs and MCP sessions keep working.
    await putWorkerSecretWithToken(apiToken,accountId,workerName,"CLOUDFLARE_CONTROL_TOKEN",apiToken);

    const before=await probeVersion(coreUrl);
    if(before.version!==CORE_WORKER_BUNDLE_VERSION){
      await updateWorkerBundlePreservingBindings(apiToken,accountId,workerName,CORE_WORKER_BUNDLE);
      if(!await waitForVersion(coreUrl,CORE_WORKER_BUNDLE_VERSION)) throw new Error(`CORE_RECOVERY_UPDATE_TIMEOUT:${CORE_WORKER_BUNDLE_VERSION}`);
    }

    const pair=await fetch(`${coreUrl}/control/pair-browser`,{
      method:"POST",
      headers:{"content-type":"application/json","x-corvo-control-token":apiToken},
      body:JSON.stringify({label:String(body.deviceLabel||request.headers.get("user-agent")||"browser").slice(0,80)}),
      cache:"no-store",
      signal:AbortSignal.timeout(15_000),
    });
    const value=await pair.json().catch(()=>({})) as any;
    if(!pair.ok||!value?.token) throw new Error(value?.error||`PAIR_BROWSER_HTTP_${pair.status}`);
    return NextResponse.json({
      ok:true,
      browserToken:String(value.token),
      deviceId:String(value.deviceId||""),
      expiresAt:Number(value.expiresAt||0),
      coreVersion:String(value.core_version||CORE_WORKER_BUNDLE_VERSION),
      updatedCore:before.version!==CORE_WORKER_BUNDLE_VERSION,
      preservedExistingBindings:true,
      d1ReadRequired:false,
    },{headers:{"cache-control":"no-store"}});
  } catch(error){
    const value=error as {message?:string;status?:number;details?:unknown};
    return NextResponse.json({error:value?.message||"BROWSER_RECOVERY_FAILED",details:value?.details||null},{status:Number(value?.status||500),headers:{"cache-control":"no-store"}});
  }
}
