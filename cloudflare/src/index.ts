import type { Env, MaterializeJob } from "./types";
import { handleMcp } from "./mcp";
import { authorized } from "./core/auth";
import { catalogStats, getAsset, listAssets, listUniverses } from "./core/assets";
import { approvePendingAssets, catalogAsset, getAssetHistory, registerAssetUsage, rejectAsset, restoreAsset, updateAssetMetadata } from "./core/asset-ops";
import { corsHeaders, json, withCors } from "./core/http";
import { approveCandidate, fastPush, getOperation, listCandidates, materialize, rejectCandidate } from "./core/ingest";
import { integritySample, r2Inventory, serveCandidateFile, serveFile } from "./core/storage";
import { addAssetsToBatch, createBatch, createRequest, generateBatchManifest, getBatch, listBatches, listImports, listRequests, removeAssetsFromBatch, updateBatchStatus, updateRequest } from "./core/work-items";
import { createAutomaticProject, getAutomaticProjectDetails, listAutomaticProjects } from "./core/projects";

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
  let queueBacklog: number | null = null;
  try {
    const metrics = await env.MATERIALIZE_QUEUE.metrics();
    queueBacklog = metrics.backlogCount;
  } catch {
    // Queue metrics are diagnostic only; queue send/consumer remains the functional check.
  }
  return { ok: d1 === "ok" && r2 === "ok" && schema === "ok", service: "corvo-core", version: "0.3.0", d1, r2, schema, queue: "ok" as const, queueBacklog };
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

    if (!authorized(request, env)) return withCors(json({ error: "UNAUTHORIZED" }, { status: 401 }), request);

    let response: Response;
    if (url.pathname === "/health" && request.method === "GET") response = json(await health(env));
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
    else if (url.pathname === "/storage/r2" && request.method === "GET") response = json(await r2Inventory(request, env));
    else if (url.pathname === "/storage/integrity" && request.method === "GET") response = json(await integritySample(env, Number(url.searchParams.get("limit") || 100)));
    else if (url.pathname === "/fast-push" && request.method === "POST") {
      const value = await fastPush(request, env);
      response = "error" in value ? json({ error: value.error }, { status: value.status }) : json({ accepted: value.accepted, operationId: value.operationId, status: value.status }, { status: value.httpStatus });
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

  async queue(batch: MessageBatch<MaterializeJob>, env: Env) {
    for (const message of batch.messages) await materialize(message, env);
  },
};
