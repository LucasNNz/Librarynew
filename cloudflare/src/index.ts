import type { CorvoQueueJob, Env, MaterializeJob } from "./types";
import { handleMcp } from "./mcp";
import { authorized } from "./core/auth";
import { catalogStats, getAsset, listAssets, listUniverses } from "./core/assets";
import { approvePendingAssets, catalogAsset, deleteAssetPermanently, deleteAssetsPermanently, deletePendingAssetsPermanently, getAssetHistory, registerAssetUsage, rejectAsset, restoreAsset, updateAssetMetadata } from "./core/asset-ops";
import { corsHeaders, json, withCors } from "./core/http";
import { approveCandidate, fastPush, getOperation, listCandidates, materialize, rejectCandidate } from "./core/ingest";
import { integritySample, r2Inventory, serveCandidateFile, serveFile, serveSupervisorCandidateFile } from "./core/storage";
import { exploreR2 } from "./core/r2-explorer";
import { deleteMissingPendingMedia, repairPendingMedia, scanPendingMedia } from "./core/pending-r2-reconcile";
import { addAssetsToBatch, createBatch, createRequest, generateBatchManifest, getBatch, listBatches, listImports, listRequests, removeAssetsFromBatch, updateBatchStatus, updateRequest } from "./core/work-items";
import { configureAutomaticProject, createAutomaticProject, getAutomaticProjectDetails, listAutomaticProjects, processAutomaticProject, projectAvailability, projectLog, reconcileAutomaticProject, reopenAutomaticProject, validateProjectConsistency } from "./core/projects";
import { fullStorageAudit, latestStorageAudit } from "./core/storage-audit";
import { findDuplicateHash, getMaterializationStats, listHostHealth, listIngestEvents, probeRemoteUrl, retryIngestCandidate } from "./core/materialization";
import { latestOperation, listOperations, mcpPerformance, operationalRisk, pipelineTelemetry, sourceRouteRanking } from "./core/operations";
import { claimNextWork, completeWork, configureWorkerLimit, dispatcherHealth, failWork, heartbeatWorker, workerWatchdog } from "./core/workers";
import { confirmDirectUpload, getDirectUpload, prepareDirectUpload, receiveDirectUpload } from "./core/direct-upload";
import { appliedPolicies, createOperationalPolicy, detectOperationalGap, editOperationalPolicy, getOperationalGap, linkGapPolicy, listOperationalGaps, listOperationalPolicies, policyTelemetry, policyWorkspace, resolveGapAndLearn, rollbackPolicy, setPolicyStatus, testPolicy } from "./core/policies";
import { backfillLegacyProjects, claimNextSupervisorWork, configureSupervisor, heartbeatSupervisor, listSupervisorCandidatesWithLinks, listSupervisorDecisions, nightlySummary, resolveSupervisorDecision, supervisorLeaseTelemetry, supervisorPanel, supervisorStatus, supervisorWatchdog } from "./core/supervisor";
import { bindingStatus, listSafeSettings, updateSafeSetting } from "./core/settings";
import { alterInfrastructureProfile, getInfrastructureProfile, initializeInfrastructureProfile, verifyInfrastructureProfile } from "./core/infrastructure";
import { configureStockPolicy, evaluateCollectionNeed, registerAssetConsultation, stockPanel, stockTextReport } from "./core/stock";
import { controlJobResult, enqueueApprovalsByItems, enqueueFastApproveProjectItems, enqueueSupervisorDecisions, processFastApproveJob, processSupervisorDecisionsJob, rejectProjectItems, relinkProjectItems } from "./core/fast-control";
import { confirmPackageDownload, decideProjectThumbs, decideProjectTitles, getPackageLink, listReadyPackages, processPackageJob, projectProductionPackage, projectThumbLinks, pushProjectTitles, queueFinalPackage, servePackageFile, serveProjectMedia } from "./core/production";
import { addProjectQaEvent, getProjectFileLink, listProjectFiles, readProjectFile, serveProjectFile } from "./core/project-files";
import { createSourceRoutingPlan, executeUntilDivergence, getPlanDetails, getPlanExceptions, getPlanStatus, getWorkPacket, setPlanStatus, supervisorExchange, tickPlans } from "./core/plans";
import { collectionAnalysis, collectionReport, collectionStatus, configureCollectionSource, controlCollectionBatch, createCollectionBatch, enqueueCollection, listCollectionBatches, listCollectionSources, processCollectionJob } from "./core/collection";
import { importZipByUrl, prepareZipUpload, processZipImport, syncR2Uncataloged } from "./core/imports-v2";
import { addCandidatesToMaterializationItem, addMaterializationItems, assetsForQa, cancelMaterializationBatch, cleanMaterializationTemporaries, createContinuousMaterializationQueue, getMaterializationBatchStatus, getMaterializationItemStatus, materializeBatchCompat, registerMaterializationQa } from "./core/materialization-compat";
import { getAssetExportLink, processAssetExportJob, queueAssetExport, serveAssetExport } from "./core/asset-exports";
import { dataHealth } from "./core/data-health";
import { applyMigrationsFromApp, selfUpdateCore } from "./core/control-plane";
import { maintenanceStatus, runPendingMaintenance } from "./core/maintenance";
import { writeD1StructureManifest } from "./core/recovery-manifest";
import { heartbeatOperation, runtimeHeartbeatStatus, runtimeHeartbeatWatchdog } from "./core/heartbeats";

async function health(env: Env) {
  let d1: "ok" | "error" = "ok";
  let r2: "ok" | "error" = "ok";
  let schema: "ok" | "missing" = "ok";
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    const legacy = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").first();
    const v2 = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_ingest_operations'").first();
    if (!legacy || !v2) schema = "missing";
  } catch {
    d1 = "error";
  }
  try {
    await env.MEDIA.list({ limit: 1 });
  } catch {
    r2 = "error";
  }
  const signing: "ok" | "error" = env.CORVO_SIGNING_KEY ? "ok" : "error";
  const appAuth: "ok" | "error" = env.CORVO_APP_KEY ? "ok" : "error";
  const control: "ok" | "error" = env.CLOUDFLARE_CONTROL_TOKEN ? "ok" : "error";
  let queueBacklog: number | null = null;
  try {
    const metrics = await env.MATERIALIZE_QUEUE.metrics();
    queueBacklog = metrics.backlogCount;
  } catch {
    // Queue metrics are diagnostic only; queue send/consumer remains the functional check.
  }
  const infrastructure = await getInfrastructureProfile(env).catch(() => ({ initialized:false, profile:null }));
  return { ok: d1 === "ok" && r2 === "ok" && schema === "ok" && signing === "ok" && appAuth === "ok", service: "corvo-core", version: "0.19.0", d1, r2, schema, queue: "ok" as const, signing, appAuth, control, queueBacklog, infrastructure: { initialized: infrastructure.initialized, profile: infrastructure.profile } };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (request.method !== "OPTIONS" && !authorized(request, env)) return json({ error: "UNAUTHORIZED" }, { status: 401 });
      return handleMcp(request, env, ctx);
    }

    if (url.pathname.startsWith("/files/") && request.method === "GET") {
      return withCors(await serveFile(request, decodeURIComponent(url.pathname.slice(7)), env), request);
    }
    if (url.pathname.startsWith("/candidate-files/") && request.method === "GET") {
      return withCors(await serveCandidateFile(request, decodeURIComponent(url.pathname.slice(17)), env), request);
    }
    if (url.pathname.startsWith("/supervisor-candidate-files/") && request.method === "GET") {
      return withCors(await serveSupervisorCandidateFile(request, decodeURIComponent(url.pathname.slice(28)), env), request);
    }
    if (url.pathname.startsWith("/package-files/") && request.method === "GET") return withCors(await servePackageFile(request,decodeURIComponent(url.pathname.slice(15)),env),request);
    if (url.pathname.startsWith("/project-media/") && request.method === "GET") return withCors(await serveProjectMedia(request,decodeURIComponent(url.pathname.slice(15)),env),request);
    if (url.pathname.startsWith("/project-files/") && request.method === "GET") return withCors(await serveProjectFile(request,decodeURIComponent(url.pathname.slice(15)),env),request);
    if (url.pathname.startsWith("/asset-exports/") && request.method === "GET") return withCors(await serveAssetExport(request,env,decodeURIComponent(url.pathname.slice(15))),request);
    if (/^\/uploads\/[^/]+$/.test(url.pathname) && request.method === "PUT") {
      return withCors(await receiveDirectUpload(request, decodeURIComponent(url.pathname.split("/")[2]), env), request);
    }

    if (!authorized(request, env)) return withCors(json({ error: "UNAUTHORIZED" }, { status: 401 }), request);

    let response: Response;
    if (url.pathname === "/health" && request.method === "GET") { ctx.waitUntil(runPendingMaintenance(env).catch(()=>undefined)); response = json(await health(env)); }
    else if (url.pathname === "/control/update-core" && request.method === "POST") response = json(await selfUpdateCore(env), { status: 202 });
    else if (url.pathname === "/control/apply-migrations" && request.method === "POST") response = json(await applyMigrationsFromApp(env));
    else if (url.pathname === "/data-health" && request.method === "GET") response = json(await dataHealth(env));
    else if (url.pathname === "/maintenance" && request.method === "GET") response = json(await maintenanceStatus(env));
    else if (url.pathname === "/recovery/d1-structure" && request.method === "POST") response = json(await writeD1StructureManifest(env,"MANUAL_REFRESH",null));
    else if (url.pathname === "/assets" && request.method === "GET") response = json(await listAssets(request, env));
    else if (url.pathname === "/assets" && request.method === "POST") {
      const value = await catalogAsset(request, await request.json(), env);
      response = "error" in value ? json(value, { status: value.status }) : json(value, { status: 201 });
    }
    else if (/^\/assets\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      const assetId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await getAsset(request, assetId, env);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (/^\/assets\/[^/]+\/history$/.test(url.pathname) && request.method === "GET") {
      const assetId = decodeURIComponent(url.pathname.split("/")[2]);
      response = json({ items: await getAssetHistory(assetId, env) });
    }
    else if (/^\/assets\/[^/]+\/metadata$/.test(url.pathname) && request.method === "PATCH") {
      const assetId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await updateAssetMetadata(request, assetId, await request.json(), env);
      response = "error" in value ? json(value, { status: value.status }) : json(value);
    }
    else if (/^\/assets\/[^/]+\/reject$/.test(url.pathname) && request.method === "POST") {
      const assetId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await request.json() as { reason?: string };
      const value = await rejectAsset(request, assetId, body.reason || "Rejeitado pela API V2", env);
      response = "error" in value ? json(value, { status: value.status }) : json(value);
    }
    else if (/^\/assets\/[^/]+\/restore$/.test(url.pathname) && request.method === "POST") {
      const assetId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await restoreAsset(request, assetId, env);
      response = "error" in value ? json(value, { status: value.status }) : json(value);
    }
    else if (url.pathname === "/asset-usages" && request.method === "POST") {
      const value = await registerAssetUsage(request, await request.json(), env);
      response = "error" in value ? json(value, { status: value.status }) : json(value, { status: 201 });
    }
    else if (url.pathname === "/assets/approve-pending" && request.method === "POST") {
      const body = await request.json() as { assetIds?: string[]; note?: string };
      response = json(await approvePendingAssets(request, body.assetIds || [], body.note, env));
    }
    else if (url.pathname === "/projects" && request.method === "GET") response = json(await listAutomaticProjects(env, Number(url.searchParams.get("limit") || 50), url.searchParams.get("cursor")));
    else if (url.pathname === "/projects" && request.method === "POST") {
      const body = await request.json() as Parameters<typeof createAutomaticProject>[1];
      if (!body.nome?.trim()) response = json({error:"INVALID_INPUT"},{status:400}); else response = json(await createAutomaticProject(env,body),{status:201});
    }
    else if (/^\/projects\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getAutomaticProjectDetails(env,projectId);
      response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/config$/.test(url.pathname) && request.method === "PATCH") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await configureAutomaticProject(env,projectId,await request.json());
      response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/process$/.test(url.pathname) && request.method === "POST") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await processAutomaticProject(env,projectId); response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/reconcile$/.test(url.pathname) && request.method === "POST") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await reconcileAutomaticProject(env,projectId); response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/validate$/.test(url.pathname) && request.method === "GET") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await validateProjectConsistency(env,projectId); response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/reopen$/.test(url.pathname) && request.method === "POST") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json().catch(()=>({})) as {reason?:string}; const value=await reopenAutomaticProject(env,projectId,body.reason); response=value?json(value):json({error:"NOT_FOUND"},{status:404});
    }
    else if (/^\/projects\/[^/]+\/availability$/.test(url.pathname) && request.method === "GET") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); response=json(await projectAvailability(env,projectId));
    }
    else if (/^\/projects\/[^/]+\/log$/.test(url.pathname) && request.method === "GET") {
      const projectId=decodeURIComponent(url.pathname.split("/")[2]); response=json({items:await projectLog(env,projectId,Number(url.searchParams.get("limit")||200))});
    }
    else if (url.pathname === "/requests" && request.method === "GET") response = json({ items: await listRequests(env, Number(url.searchParams.get("limit") || 100)) });
    else if (url.pathname === "/requests" && request.method === "POST") {
      const body = await request.json() as { project?: string; items?: string };
      if (!body.project?.trim() || !body.items?.trim()) response = json({ error: "INVALID_INPUT" }, { status: 400 });
      else response = json(await createRequest(env, body.project, body.items), { status: 201 });
    }
    else if (/^\/requests\/[^/]+$/.test(url.pathname) && request.method === "PATCH") {
      const requestId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await request.json() as { project?: string; items?: string; status?: string };
      const value = await updateRequest(env, requestId, { projeto: body.project, itens: body.items, status: body.status });
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (url.pathname === "/batches" && request.method === "GET") response = json({ items: await listBatches(env, Number(url.searchParams.get("limit") || 100)) });
    else if (url.pathname === "/batches" && request.method === "POST") {
      const body = await request.json() as { name?: string; project?: string; assetIds?: string[] };
      if (!body.name?.trim()) response = json({ error: "INVALID_INPUT" }, { status: 400 });
      else response = json(await createBatch(env, body.name, body.project, body.assetIds), { status: 201 });
    }
    else if (/^\/batches\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      const batchId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await getBatch(env, batchId);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (/^\/batches\/[^/]+\/assets$/.test(url.pathname) && request.method === "POST") {
      const batchId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await request.json() as { assetIds?: string[] };
      const value = await addAssetsToBatch(env, batchId, body.assetIds || []);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (/^\/batches\/[^/]+\/assets\/remove$/.test(url.pathname) && request.method === "POST") {
      const batchId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await request.json() as { assetIds?: string[] };
      const value = await removeAssetsFromBatch(env, batchId, body.assetIds || []);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (/^\/batches\/[^/]+\/status$/.test(url.pathname) && request.method === "PATCH") {
      const batchId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await request.json() as { status?: string };
      if (!body.status?.trim()) response = json({ error: "INVALID_INPUT" }, { status: 400 });
      else {
        const value = await updateBatchStatus(env, batchId, body.status);
        response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
      }
    }
    else if (/^\/batches\/[^/]+\/manifest$/.test(url.pathname) && request.method === "POST") {
      const batchId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await generateBatchManifest(env, batchId);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (url.pathname === "/imports" && request.method === "GET") response = json({ items: await listImports(env, Number(url.searchParams.get("limit") || 100)) });
    else if (url.pathname === "/catalog/stats" && request.method === "GET") response = json(await catalogStats(env));
    else if (url.pathname === "/catalog/universes" && request.method === "GET") response = json({ universes: await listUniverses(env) });
    else if (url.pathname === "/uploads/prepare" && request.method === "POST") { const body=await request.json() as Parameters<typeof prepareDirectUpload>[2]; response=json(await prepareDirectUpload(request,env,body),{status:201}); }
    else if (/^\/uploads\/[^/]+\/confirm$/.test(url.pathname) && request.method === "POST") { const uploadId=decodeURIComponent(url.pathname.split("/")[2]); const value=await confirmDirectUpload(env,uploadId); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (/^\/uploads\/[^/]+$/.test(url.pathname) && request.method === "GET") { const uploadId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getDirectUpload(env,uploadId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (url.pathname === "/storage/r2" && request.method === "GET") response = json(await r2Inventory(request, env));
    else if (url.pathname === "/storage/r2/explore" && request.method === "GET") response = json(await exploreR2(request, env));
    else if (url.pathname === "/storage/r2/pending-reconcile" && request.method === "GET") response = json(await scanPendingMedia(request, env));
    else if (url.pathname === "/storage/r2/pending-reconcile" && request.method === "POST") response = json(await repairPendingMedia(env, await request.json() as {assetIds?:string[];maxObjects?:number}));
    else if (url.pathname === "/storage/r2/pending-reconcile/delete-missing" && request.method === "POST") { const body=await request.json() as {confirm?:boolean;maxObjects?:number}; const value=await deleteMissingPendingMedia(env,body); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/storage/integrity" && request.method === "GET") response = json(await integritySample(env, Number(url.searchParams.get("limit") || 100)));
    else if (url.pathname === "/storage/audit" && request.method === "POST") response = json(await fullStorageAudit(env, Number(url.searchParams.get("maxObjects") || 10000)));
    else if (url.pathname === "/storage/audit/latest" && request.method === "GET") response = json({ audit: await latestStorageAudit(env) });
    else if (url.pathname === "/materialization/stats" && request.method === "GET") response = json(await getMaterializationStats(env));
    else if (url.pathname === "/materialization/host-health" && request.method === "GET") response = json({items:await listHostHealth(env,Number(url.searchParams.get("limit")||100))});
    else if (url.pathname === "/materialization/probe" && request.method === "POST") { const body=await request.json() as {url?:string;timeoutMs?:number}; response=body.url?json(await probeRemoteUrl(env,body.url,body.timeoutMs)):json({error:"INVALID_INPUT"},{status:400}); }
    else if (url.pathname === "/materialization/events" && request.method === "GET") response=json({items:await listIngestEvents(env,{operationId:url.searchParams.get("operationId")||undefined,candidateId:url.searchParams.get("candidateId")||undefined,limit:Number(url.searchParams.get("limit")||100)})});
    else if (/^\/materialization\/candidates\/[^/]+\/retry$/.test(url.pathname) && request.method === "POST") { const candidateId=decodeURIComponent(url.pathname.split("/")[3]); const value=await retryIngestCandidate(candidateId,env); response="error" in value?json(value,{status:value.status}):json(value,{status:202}); }
    else if (url.pathname === "/materialization/duplicates" && request.method === "GET") { const hash=url.searchParams.get("sha256")||""; response=hash?json(await findDuplicateHash(env,hash)):json({error:"INVALID_INPUT"},{status:400}); }
    else if (url.pathname === "/operations" && request.method === "GET") response=json({items:await listOperations(env,Number(url.searchParams.get("limit")||100),url.searchParams.get("status"))});
    else if (url.pathname === "/operations/latest" && request.method === "GET") response=json({operation:await latestOperation(env,url.searchParams.get("type"))});
    else if (url.pathname === "/operations/telemetry" && request.method === "GET") response=json(await pipelineTelemetry(env));
    else if (url.pathname === "/operations/mcp-performance" && request.method === "GET") response=json(await mcpPerformance(env,Number(url.searchParams.get("limit")||100)));
    else if (url.pathname === "/operations/source-ranking" && request.method === "GET") response=json({items:await sourceRouteRanking(env,Number(url.searchParams.get("limit")||100))});
    else if (url.pathname === "/operations/risk" && request.method === "GET") response=json(await operationalRisk(env));
    else if (/^\/operations\/[^/]+\/heartbeat$/.test(url.pathname) && request.method === "POST") { const operationId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {ownerId:string;executionId:string;ttlSeconds?:number;reclaimExpired?:boolean;metadata?:unknown}; const value=await heartbeatOperation(env,{operationId,ownerId:body.ownerId,executionId:body.executionId,ttlSeconds:body.ttlSeconds,reclaimExpired:body.reclaimExpired,metadata:body.metadata}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/heartbeats" && request.method === "GET") response=json(await runtimeHeartbeatStatus(env,{scopeType:url.searchParams.get("scopeType")||undefined,limit:Number(url.searchParams.get("limit")||100)}));
    else if (url.pathname === "/heartbeats/watchdog" && request.method === "POST") response=json(await runtimeHeartbeatWatchdog(env));
    else if (url.pathname === "/workers/health" && request.method === "GET") response=json(await dispatcherHealth(env));
    else if (url.pathname === "/workers/claim" && request.method === "POST") response=json(await claimNextWork(env,await request.json()));
    else if (/^\/workers\/work\/[^/]+\/heartbeat$/.test(url.pathname) && request.method === "POST") { const workItemId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {workerId:string;executionId:string;leaseSeconds?:number}; const value=await heartbeatWorker(env,{workItemId,workerId:body.workerId,executionId:body.executionId,leaseSeconds:body.leaseSeconds}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (/^\/workers\/work\/[^/]+\/complete$/.test(url.pathname) && request.method === "POST") { const workItemId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {workerId:string;result?:unknown}; const value=await completeWork(env,{workItemId,workerId:body.workerId,result:body.result}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (/^\/workers\/work\/[^/]+\/fail$/.test(url.pathname) && request.method === "POST") { const workItemId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {workerId:string;reason:string;retry?:boolean;delaySeconds?:number}; const value=await failWork(env,{workItemId,...body}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/workers/watchdog" && request.method === "POST") response=json(await workerWatchdog(env));
    else if (url.pathname === "/workers/limits" && request.method === "POST") response=json(await configureWorkerLimit(env,await request.json()));
    else if (url.pathname === "/settings" && request.method === "GET") response=json({items:await listSafeSettings(env),bindings:await bindingStatus(env)});
    else if (url.pathname === "/settings" && request.method === "PATCH") { const body=await request.json() as {key?:string;value?:unknown}; response=body.key?json(await updateSafeSetting(env,body.key,body.value)):json({error:"INVALID_INPUT"},{status:400}); }
    else if (url.pathname === "/infrastructure/config" && request.method === "GET") response=json(await getInfrastructureProfile(env));
    else if (url.pathname === "/infrastructure/config" && request.method === "POST") { const value=await initializeInfrastructureProfile(env,await request.json()); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:201}); }
    else if (url.pathname === "/infrastructure/config" && request.method === "PATCH") { const value=await alterInfrastructureProfile(env,await request.json()); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/infrastructure/verify" && request.method === "POST") { const value=await verifyInfrastructureProfile(env); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/stock" && request.method === "GET") response=json(await stockPanel(env));
    else if (url.pathname === "/stock/report" && request.method === "GET") response=json({text:await stockTextReport(env)});
    else if (url.pathname === "/stock/policies" && request.method === "POST") response=json(await configureStockPolicy(env,await request.json() as Parameters<typeof configureStockPolicy>[1]),{status:201});
    else if (url.pathname === "/stock/consultations" && request.method === "POST") response=json(await registerAssetConsultation(env,await request.json() as Parameters<typeof registerAssetConsultation>[1]),{status:201});
    else if (url.pathname === "/stock/evaluate" && request.method === "GET") { const concept=url.searchParams.get("concept")||""; response=concept?json(await evaluateCollectionNeed(env,{concept,universe:url.searchParams.get("universe")||undefined,kind:url.searchParams.get("kind")||undefined})):json({error:"INVALID_INPUT"},{status:400}); }
    else if (url.pathname === "/policies/workspace" && request.method === "GET") response=json(await policyWorkspace(env,url.searchParams.get("projectId")||undefined));
    else if (url.pathname === "/policies/gaps" && request.method === "GET") response=json({items:await listOperationalGaps(env,{status:url.searchParams.get("status")||undefined,severity:url.searchParams.get("severity")||undefined,category:url.searchParams.get("category")||undefined,projectId:url.searchParams.get("projectId")||undefined,limit:Number(url.searchParams.get("limit")||100)})});
    else if (url.pathname === "/policies/gaps" && request.method === "POST") { const body=await request.json() as Parameters<typeof detectOperationalGap>[1]; response=json(await detectOperationalGap(env,body),{status:201}); }
    else if (/^\/policies\/gaps\/[^/]+$/.test(url.pathname) && request.method === "GET") { const gapId=decodeURIComponent(url.pathname.split("/")[3]); const value=await getOperationalGap(env,gapId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/policies\/gaps\/[^/]+\/resolve$/.test(url.pathname) && request.method === "POST") { const gapId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as Parameters<typeof resolveGapAndLearn>[2]; const value=await resolveGapAndLearn(env,gapId,body); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (url.pathname === "/policies" && request.method === "GET") response=json({items:await listOperationalPolicies(env,{status:url.searchParams.get("status")||undefined,category:url.searchParams.get("category")||undefined,projectId:url.searchParams.get("projectId")||undefined,policyKey:url.searchParams.get("policyKey")||undefined,limit:Number(url.searchParams.get("limit")||100)})});
    else if (url.pathname === "/policies" && request.method === "POST") { const body=await request.json() as Parameters<typeof createOperationalPolicy>[1]; response=json(await createOperationalPolicy(env,body),{status:201}); }
    else if (/^\/policies\/[^/]+$/.test(url.pathname) && request.method === "PATCH") { const policyId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as Parameters<typeof editOperationalPolicy>[2]; const value=await editOperationalPolicy(env,policyId,body); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/policies\/[^/]+\/test$/.test(url.pathname) && request.method === "POST") { const policyId=decodeURIComponent(url.pathname.split("/")[2]); const value=await testPolicy(env,policyId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/policies\/[^/]+\/status$/.test(url.pathname) && request.method === "POST") { const policyId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {status?:string;eventType?:string}; if(!body.status) response=json({error:"INVALID_INPUT"},{status:400}); else {const value=await setPolicyStatus(env,policyId,body.status,body.eventType||"STATUS_CHANGE");response=value?json(value):json({error:"NOT_FOUND"},{status:404});} }
    else if (/^\/policies\/[^/]+\/rollback$/.test(url.pathname) && request.method === "POST") { const policyId=decodeURIComponent(url.pathname.split("/")[2]); response=json(await rollbackPolicy(env,policyId)); }
    else if (url.pathname === "/policies/events" && request.method === "GET") response=json({items:await appliedPolicies(env,url.searchParams.get("projectId")||undefined,Number(url.searchParams.get("limit")||200))});
    else if (url.pathname === "/policies/telemetry" && request.method === "GET") response=json(await policyTelemetry(env));
    else if (url.pathname === "/policies/link" && request.method === "POST") { const body=await request.json() as {gapId?:string;policyId?:string}; if(!body.gapId||!body.policyId) response=json({error:"INVALID_INPUT"},{status:400}); else {const value=await linkGapPolicy(env,body.gapId,body.policyId);response=value?json(value):json({error:"NOT_FOUND"},{status:404});} }
    else if (url.pathname === "/supervisor/status" && request.method === "GET") response=json(await supervisorStatus(env));
    else if (url.pathname === "/supervisor/panel" && request.method === "GET") response=json(await supervisorPanel(env,url.searchParams.get("projectId")||undefined));
    else if (url.pathname === "/supervisor/config" && request.method === "POST") response=json(await configureSupervisor(env,await request.json() as Record<string,unknown>));
    else if (url.pathname === "/supervisor/claim" && request.method === "POST") response=json(await claimNextSupervisorWork(env,await request.json() as Parameters<typeof claimNextSupervisorWork>[1]));
    else if (url.pathname === "/supervisor/heartbeat" && request.method === "POST") { const body=await request.json() as {projectId:string;executionId:string;workerId?:string;leaseMinutes?:number}; const value=await heartbeatSupervisor(env,{projectId:body.projectId,executionId:body.executionId,ownerId:body.workerId,leaseMinutes:body.leaseMinutes}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/supervisor/watchdog" && request.method === "POST") response=json(await supervisorWatchdog(env));
    else if (url.pathname === "/supervisor/leases" && request.method === "GET") response=json(await supervisorLeaseTelemetry(env));
    else if (url.pathname === "/supervisor/backfill" && request.method === "POST") { response=json({error:"LEGACY_PROJECT_BACKFILL_DISABLED",detail:"Projetos históricos foram removidos por decisão operacional; novos projetos devem ser criados na V2."},{status:410}); }
    else if (url.pathname === "/supervisor/decisions" && request.method === "GET") response=json({items:await listSupervisorDecisions(env,{projectId:url.searchParams.get("projectId")||undefined,state:url.searchParams.get("state")||undefined,type:url.searchParams.get("type")||undefined,limit:Number(url.searchParams.get("limit")||100)})});
    else if (/^\/supervisor\/decisions\/[^/]+\/resolve$/.test(url.pathname) && request.method === "POST") { const decisionId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {decision?:string;observation?:string}; if(!body.decision) response=json({error:"INVALID_INPUT"},{status:400}); else {const value=await resolveSupervisorDecision(env,decisionId,{decision:body.decision,observation:body.observation});response=value?json(value):json({error:"NOT_FOUND_OR_RESOLVED"},{status:404});} }
    else if (url.pathname === "/supervisor/candidates" && request.method === "GET") response=json({items:await listSupervisorCandidatesWithLinks(request,env,{projectId:url.searchParams.get("projectId")||undefined,status:url.searchParams.get("status")||"PARA_ANALISE",limit:Number(url.searchParams.get("limit")||100)})});
    else if (url.pathname === "/supervisor/nightly-summary" && request.method === "GET") response=json(await nightlySummary(env));
    else if (url.pathname === "/control/fast-approve" && request.method === "POST") { const value=await enqueueFastApproveProjectItems(env,await request.json() as Parameters<typeof enqueueFastApproveProjectItems>[1]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:202}); }
    else if (url.pathname === "/control/approve-items" && request.method === "POST") response=json(await enqueueApprovalsByItems(env,await request.json() as Parameters<typeof enqueueApprovalsByItems>[1]),{status:202});
    else if (url.pathname === "/control/relink-items" && request.method === "POST") response=json(await relinkProjectItems(env,await request.json() as Parameters<typeof relinkProjectItems>[1]),{status:202});
    else if (url.pathname === "/control/reject-items" && request.method === "POST") response=json(await rejectProjectItems(env,await request.json() as Parameters<typeof rejectProjectItems>[1]),{status:202});
    else if (url.pathname === "/control/supervisor-decisions" && request.method === "POST") response=json(await enqueueSupervisorDecisions(env,await request.json() as Parameters<typeof enqueueSupervisorDecisions>[1]),{status:202});
    else if (/^\/control\/operations\/[^/]+$/.test(url.pathname) && request.method === "GET") { const operationId=decodeURIComponent(url.pathname.split("/")[3]); const value=await controlJobResult(env,operationId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (url.pathname === "/packages" && request.method === "POST") { const value=await queueFinalPackage(env,await request.json() as Parameters<typeof queueFinalPackage>[1]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:202}); }
    else if (url.pathname === "/packages" && request.method === "GET") response=json(await listReadyPackages(env,{projectId:url.searchParams.get("projectId")||undefined,status:url.searchParams.get("status")||undefined,limit:Number(url.searchParams.get("limit")||100)}));
    else if (/^\/packages\/[^/]+\/link$/.test(url.pathname) && request.method === "GET") { const packageId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getPackageLink(request,env,packageId,Number(url.searchParams.get("ttlMinutes")||30)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (/^\/packages\/[^/]+\/confirm$/.test(url.pathname) && request.method === "POST") { const packageId=decodeURIComponent(url.pathname.split("/")[2]); const value=await confirmPackageDownload(env,packageId,await request.json() as Parameters<typeof confirmPackageDownload>[2]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (/^\/projects\/[^/]+\/production$/.test(url.pathname) && request.method === "GET") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await projectProductionPackage(request,env,projectId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/projects\/[^/]+\/thumbs$/.test(url.pathname) && request.method === "GET") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); response=json(await projectThumbLinks(request,env,projectId,Number(url.searchParams.get("limit")||50))); }
    else if (/^\/projects\/[^/]+\/thumbs\/decide$/.test(url.pathname) && request.method === "POST") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {decisions?:Parameters<typeof decideProjectThumbs>[2]}; response=json(await decideProjectThumbs(env,projectId,body.decisions||[])); }
    else if (/^\/projects\/[^/]+\/titles$/.test(url.pathname) && request.method === "POST") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {titles?:Parameters<typeof pushProjectTitles>[2]}; response=json(await pushProjectTitles(env,projectId,body.titles||[])); }
    else if (/^\/projects\/[^/]+\/titles\/decide$/.test(url.pathname) && request.method === "POST") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {decisions?:Parameters<typeof decideProjectTitles>[2]}; response=json(await decideProjectTitles(env,projectId,body.decisions||[])); }
    else if (/^\/projects\/[^/]+\/files$/.test(url.pathname) && request.method === "GET") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const value=await listProjectFiles(request,env,projectId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/projects\/[^/]+\/files\/read$/.test(url.pathname) && request.method === "GET") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); const role=url.searchParams.get("role")||"SCRIPT"; const value=await readProjectFile(env,projectId,role,url.searchParams.get("version")?Number(url.searchParams.get("version")):undefined); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/projects\/[^/]+\/qa$/.test(url.pathname) && request.method === "POST") { const projectId=decodeURIComponent(url.pathname.split("/")[2]); response=json(await addProjectQaEvent(env,projectId,await request.json() as Parameters<typeof addProjectQaEvent>[2])); }
    else if (/^\/project-file-links\/[^/]+$/.test(url.pathname) && request.method === "GET") { const fileId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getProjectFileLink(request,env,fileId,Number(url.searchParams.get("ttlMinutes")||15)); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (url.pathname === "/plans/exchange" && request.method === "POST") response=json(await supervisorExchange(env,await request.json() as Parameters<typeof supervisorExchange>[1]),{status:202});
    else if (url.pathname === "/plans/execute-until-divergence" && request.method === "POST") response=json(await executeUntilDivergence(env,await request.json() as Parameters<typeof executeUntilDivergence>[1]),{status:202});
    else if (url.pathname === "/plans/tick" && request.method === "POST") response=json(await tickPlans(env,await request.json() as Parameters<typeof tickPlans>[1]));
    else if (/^\/plans\/[^/]+\/work-packet$/.test(url.pathname) && request.method === "GET") { const planId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getWorkPacket(env,planId,Number(url.searchParams.get("limit")||20)); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/plans\/[^/]+\/status$/.test(url.pathname) && request.method === "GET") { const planId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getPlanStatus(env,planId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/plans\/[^/]+\/details$/.test(url.pathname) && request.method === "GET") { const planId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getPlanDetails(env,planId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/plans\/[^/]+\/exceptions$/.test(url.pathname) && request.method === "GET") { const planId=decodeURIComponent(url.pathname.split("/")[2]); response=json(await getPlanExceptions(env,planId,Number(url.searchParams.get("limit")||100))); }
    else if (/^\/plans\/[^/]+\/(pause|resume|cancel)$/.test(url.pathname) && request.method === "POST") { const parts=url.pathname.split("/"),planId=decodeURIComponent(parts[2]),action=parts[3]; const value=await setPlanStatus(env,planId,action==="pause"?"PAUSED":action==="resume"?"RUNNING":"CANCELLED"); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (url.pathname === "/plans/source-routing" && request.method === "POST") response=json(await createSourceRoutingPlan(env,await request.json() as Parameters<typeof createSourceRoutingPlan>[1]),{status:201});
    else if (url.pathname === "/collection/sources" && request.method === "GET") response=json(await listCollectionSources(env));
    else if (url.pathname === "/collection/sources" && request.method === "POST") { const value=await configureCollectionSource(env,await request.json() as Parameters<typeof configureCollectionSource>[1]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:201}); }
    else if (url.pathname === "/collection/batches" && request.method === "GET") response=json(await listCollectionBatches(env,Number(url.searchParams.get("limit")||50)));
    else if (url.pathname === "/collection/batches" && request.method === "POST") { const value=await createCollectionBatch(env,await request.json() as Parameters<typeof createCollectionBatch>[1]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:201}); }
    else if (/^\/collection\/batches\/[^/]+\/run$/.test(url.pathname) && request.method === "POST") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {rounds?:number;operationId?:string}; const value=await enqueueCollection(env,{batchId,...body}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:202}); }
    else if (/^\/collection\/batches\/[^/]+\/status$/.test(url.pathname) && request.method === "GET") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const value=await collectionStatus(env,batchId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/collection\/batches\/[^/]+\/report$/.test(url.pathname) && request.method === "GET") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const value=await collectionReport(env,batchId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/collection\/batches\/[^/]+\/analysis$/.test(url.pathname) && request.method === "GET") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); response=json(await collectionAnalysis(env,batchId)); }
    else if (/^\/collection\/batches\/[^/]+\/(pause|resume|cancel)$/.test(url.pathname) && request.method === "POST") { const parts=url.pathname.split("/"),batchId=decodeURIComponent(parts[3]),action=parts[4].toUpperCase() as "PAUSE"|"RESUME"|"CANCEL"; const value=await controlCollectionBatch(env,batchId,action); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/assets\/[^/]+\/permanent-delete$/.test(url.pathname) && request.method === "POST") { const assetId=decodeURIComponent(url.pathname.split("/")[2]); const body=await request.json() as {confirm?:boolean}; const value=await deleteAssetPermanently(env,assetId,Boolean(body.confirm)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/assets/permanent-delete-batch" && request.method === "POST") { const body=await request.json() as {assetIds?:string[];confirm?:boolean}; const value=await deleteAssetsPermanently(env,body.assetIds||[],Boolean(body.confirm)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/assets/pending/permanent-delete" && request.method === "POST") { const body=await request.json() as {assetIds?:string[];confirm?:boolean}; const value=await deletePendingAssetsPermanently(env,body.assetIds||[],Boolean(body.confirm)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/imports/zip/prepare" && request.method === "POST") { const body=await request.json() as {fileName?:string}; response=json(await prepareZipUpload(request,env,body.fileName||"importacao.zip"),{status:201}); }
    else if (url.pathname === "/imports/zip/url" && request.method === "POST") { const body=await request.json() as {url:string;fileName:string;manifestText?:string}; const value=await importZipByUrl(env,body); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:201}); }
    else if (/^\/imports\/[^/]+\/process$/.test(url.pathname) && request.method === "POST") { const importId=decodeURIComponent(url.pathname.split("/")[2]); const value=await processZipImport(env,importId); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:500}):json(value); }
    else if (url.pathname === "/storage/sync-r2" && request.method === "GET") response=json(await syncR2Uncataloged(env,{prefix:url.searchParams.get("prefix")||undefined,limit:Number(url.searchParams.get("limit")||1000)}));
    else if (url.pathname === "/asset-exports" && request.method === "POST") { const body=await request.json() as {assetIds?:string[];name?:string;operationId?:string}; const value=await queueAssetExport(env,{assetIds:body.assetIds||[],name:body.name,operationId:body.operationId}); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:202}); }
    else if (/^\/asset-exports\/[^/]+\/link$/.test(url.pathname) && request.method === "GET") { const exportId=decodeURIComponent(url.pathname.split("/")[2]); const value=await getAssetExportLink(request,env,exportId,Number(url.searchParams.get("ttlMinutes")||30)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/materialization/batches" && request.method === "POST") { const body=await request.json() as {batchId?:string;project:string;items?:Parameters<typeof materializeBatchCompat>[1]["items"]}; response=json(body.items?.length?await materializeBatchCompat(env,{batchId:body.batchId,project:body.project,items:body.items}):await createContinuousMaterializationQueue(env,{batchId:body.batchId,project:body.project}),{status:202}); }
    else if (/^\/materialization\/batches\/[^/]+$/.test(url.pathname) && request.method === "GET") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const value=await getMaterializationBatchStatus(env,batchId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/materialization\/batches\/[^/]+\/items$/.test(url.pathname) && request.method === "POST") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {items?:Parameters<typeof addMaterializationItems>[2]}; const value=await addMaterializationItems(env,batchId,body.items||[]); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value,{status:202}); }
    else if (/^\/materialization\/batches\/[^/]+\/qa$/.test(url.pathname) && request.method === "GET") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); response=json(await assetsForQa(request,env,batchId,Number(url.searchParams.get("limit")||20))); }
    else if (/^\/materialization\/batches\/[^/]+\/qa$/.test(url.pathname) && request.method === "POST") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {decisions?:Parameters<typeof registerMaterializationQa>[2]}; response=json(await registerMaterializationQa(env,batchId,body.decisions||[])); }
    else if (/^\/materialization\/batches\/[^/]+\/cancel$/.test(url.pathname) && request.method === "POST") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const value=await cancelMaterializationBatch(env,batchId); response=value?json(value):json({error:"NOT_FOUND"},{status:404}); }
    else if (/^\/materialization\/batches\/[^/]+\/clean$/.test(url.pathname) && request.method === "POST") { const batchId=decodeURIComponent(url.pathname.split("/")[3]); const body=await request.json() as {confirm?:boolean}; const value=await cleanMaterializationTemporaries(env,batchId,Boolean(body.confirm)); response="error" in value?json(value,{status:typeof value.status==="number"?value.status:400}):json(value); }
    else if (url.pathname === "/fast-push" && request.method === "POST") {
      const value = await fastPush(request, env);
      response = "error" in value ? json({ error: value.error }, { status: typeof value.status === "number" ? value.status : 400 }) : json({ accepted: value.accepted, operationId: value.operationId, status: value.status }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 202 });
    }
    else if (url.pathname.startsWith("/operations/") && request.method === "GET") {
      const value = await getOperation(decodeURIComponent(url.pathname.slice(12)), env);
      response = value ? json(value) : json({ error: "NOT_FOUND" }, { status: 404 });
    }
    else if (url.pathname === "/candidates" && request.method === "GET") response = json({ items: await listCandidates(request, env) });
    else if (/^\/candidates\/[^/]+\/approve$/.test(url.pathname) && request.method === "POST") {
      const candidateId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await approveCandidate(candidateId, env);
      response = "error" in value ? json(value, { status: value.status }) : json(value);
    }
    else if (/^\/candidates\/[^/]+\/reject$/.test(url.pathname) && request.method === "POST") {
      const candidateId = decodeURIComponent(url.pathname.split("/")[2]);
      const value = await rejectCandidate(candidateId, env);
      response = "error" in value ? json(value, { status: value.status }) : json(value);
    }
    else response = json({ error: "NOT_FOUND" }, { status: 404 });
    return withCors(response, request);
  },

  async queue(batch: MessageBatch<CorvoQueueJob>, env: Env) {
    for (const message of batch.messages) {
      const job=message.body;
      try {
        if (!job.kind || job.kind === "MATERIALIZE_URL") await materialize(message as Message<MaterializeJob>, env);
        else if (job.kind === "FAST_APPROVE_PROJECT_ITEMS") { await processFastApproveJob(env,job); message.ack(); }
        else if (job.kind === "SUPERVISOR_DECISIONS") { await processSupervisorDecisionsJob(env,job); message.ack(); }
        else if (job.kind === "GENERATE_PACKAGE") { await processPackageJob(env,job); message.ack(); }
        else if (job.kind === "COLLECTION_TICK") { await processCollectionJob(env,job); message.ack(); }
        else if (job.kind === "EXPORT_ASSETS") { await processAssetExportJob(env,job); message.ack(); }
        else { message.ack(); }
      } catch (error) {
        console.error("QUEUE_JOB_FAILED",job.kind,error);
        message.retry({delaySeconds:15});
      }
    }
  },
};
