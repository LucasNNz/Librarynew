import { NextRequest, NextResponse } from "next/server";
import { CORE_WORKER_BUNDLE, CORE_WORKER_BUNDLE_VERSION } from "../../../../../lib/generated-core-bundle";
import { assertR2Bucket, deployWorker, ensureQueueConsumer, getOrCreateD1, getOrCreateQueue, listAccounts, putWorkerSecretWithToken, randomSecret, updateWorkerBundlePreservingBindings, workerCoreUrl, workerExists } from "../../../../../lib/cloudflare-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  apiToken?: string;
  accountId?: string;
  workerName?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  queueName?: string;
  dlqName?: string;
};


async function pairBrowser(coreUrl:string,apiToken:string,label:string){
  let lastError="PAIR_BROWSER_UNAVAILABLE";
  for(let attempt=0;attempt<24;attempt+=1){
    if(attempt)await new Promise(resolve=>setTimeout(resolve,Math.min(1800,500+attempt*60)));
    try{
      const response=await fetch(`${coreUrl}/control/pair-browser`,{method:"POST",headers:{"content-type":"application/json","x-corvo-control-token":apiToken},body:JSON.stringify({label}),cache:"no-store",signal:AbortSignal.timeout(12_000)});
      const value=await response.json().catch(()=>({})) as any;
      if(response.ok&&value?.token)return value;
      lastError=String(value?.error||`PAIR_HTTP_${response.status}`);
    }catch(error){lastError=error instanceof Error?error.message:"PAIR_BROWSER_FAILED";}
  }
  throw new Error(lastError);
}

function clean(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  return text || fallback;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const apiToken = String(body.apiToken || "").trim();
    if (!apiToken) return NextResponse.json({ error: "CLOUDFLARE_API_TOKEN_REQUIRED" }, { status: 400 });
    if (!CORE_WORKER_BUNDLE || CORE_WORKER_BUNDLE_VERSION === "UNBUILT") {
      return NextResponse.json({ error: "CORE_WORKER_BUNDLE_NOT_BUILT", detail: "O build do app precisa executar o prebuild do Core." }, { status: 500 });
    }

    let accountId = String(body.accountId || "").trim();
    let accounts: Array<{id:string;name:string}> = [];
    if (!accountId) {
      // Some Cloudflare API Tokens cannot enumerate /accounts even when they can
      // operate on a scoped account. Detection is best-effort; Account ID is the
      // reliable self-service fallback shown in the UI.
      try { accounts = await listAccounts(apiToken); } catch { accounts = []; }
      if (accounts.length > 1) return NextResponse.json({ error: "ACCOUNT_SELECTION_REQUIRED", accounts }, { status: 409 });
      if (accounts.length === 1) accountId = accounts[0].id;
      else return NextResponse.json({ error: "ACCOUNT_ID_REQUIRED", detail: "Informe o Account ID exibido no painel Cloudflare." }, { status: 409 });
    }

    const workerName = clean(body.workerName, "corvo-core-v2");
    const d1DatabaseName = clean(body.d1DatabaseName, "corvo-library-v2");
    const r2BucketName = clean(body.r2BucketName, "corvoquiz-prod");
    const queueName = clean(body.queueName, "corvo-materialize-v2");
    const dlqName = clean(body.dlqName, "corvo-materialize-v2-dlq");

    const [d1, r2, queue, dlq] = await Promise.all([
      getOrCreateD1(apiToken, accountId, d1DatabaseName),
      assertR2Bucket(apiToken, accountId, r2BucketName),
      getOrCreateQueue(apiToken, accountId, queueName),
      getOrCreateQueue(apiToken, accountId, dlqName),
    ]);

    const existed = await workerExists(apiToken, accountId, workerName);
    let coreUrl:string;
    if(existed){
      // Never regenerate app/internal/signing secrets for an existing installation.
      // A second PC only updates the control token, publishes the current bundle
      // while preserving all bindings, then receives its own device token.
      await putWorkerSecretWithToken(apiToken,accountId,workerName,"CLOUDFLARE_CONTROL_TOKEN",apiToken);
      await updateWorkerBundlePreservingBindings(apiToken,accountId,workerName,CORE_WORKER_BUNDLE);
      coreUrl=await workerCoreUrl(apiToken,accountId,workerName);
    }else{
      const legacyAppKey = randomSecret(32);
      const internalKey = randomSecret(32);
      const signingKey = randomSecret(32);
      const deployment = await deployWorker({
        token: apiToken,
        accountId,
        workerName,
        databaseId: d1.id,
        r2BucketName,
        queueName,
        dlqName,
        appKey:legacyAppKey,
        internalKey,
        signingKey,
        workerBundle: CORE_WORKER_BUNDLE,
        appOrigin: request.nextUrl.origin,
      });
      coreUrl=deployment.coreUrl;
    }
    await ensureQueueConsumer(apiToken, accountId, queue.id, workerName, dlqName);
    const paired=await pairBrowser(coreUrl,apiToken,String(request.headers.get("user-agent")||"browser").slice(0,80));
    const browserToken=String(paired.token||"");
    if(!browserToken)throw new Error("PAIR_BROWSER_TOKEN_MISSING");

    return NextResponse.json({
      ok: true,
      accountId,
      accountName: accounts.find(item => item.id === accountId)?.name || accountId,
      connection: {
        version: 1,
        coreUrl,
        appKey:browserToken,
        accountId,
        workerName,
        d1DatabaseName,
        d1DatabaseId: d1.id,
        r2BucketName: r2.name,
        queueName,
        dlqName,
        savedAt: Date.now(),
      },
      resources: {
        d1: { ...d1 },
        r2,
        queue: { ...queue },
        dlq: { ...dlq },
        worker: { name: workerName, url: coreUrl, bundleVersion: CORE_WORKER_BUNDLE_VERSION, reused:existed },
      },
      browserSession:{kind:String(paired.kind||"DEVICE_TOKEN_V1"),deviceId:String(paired.deviceId||""),expiresAt:Number(paired.expiresAt||0)},
      restoreRecommended: d1.created,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const value = error as { message?: string; status?: number; details?: unknown };
    return NextResponse.json({ error: value?.message || "CLOUDFLARE_PROVISION_FAILED", details: value?.details || null }, { status: Number(value?.status || 500), headers: { "cache-control": "no-store" } });
  }
}
