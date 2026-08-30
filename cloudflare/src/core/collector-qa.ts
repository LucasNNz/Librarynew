import type { Env } from "../types";
import { createSignedCandidateUrl, createSignedFileUrl } from "./auth";
import { activateProjectItemCandidateReserve, approveCandidate, rejectCandidate } from "./ingest";
import { id, nowMs, stableId } from "./ids";
import { safeRemoteUrl } from "./net";
import { configureProjectItemPipeline, markProjectItemQaInProgress, refreshProjectItemPipelineState, resolveProjectItem, type ProjectPipelineItemState } from "./project-pipeline-state";
import { projectWriteGuard, syncDerivedProjectWorkflow, updateProjectWorkflow } from "./project-workflow";

function collectorClean(v: unknown) { return String(v ?? "").trim(); }
function collectorSleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function collectorUniq<T>(values: T[]) { return [...new Set(values)]; }

export type ProjectCandidatePushItem = {
  itemId: string;
  targetCandidates?: number;
  requiredApproved?: number;
  universe?: string;
  subject?: string;
  tags?: string[];
  urls: string[];
};

export async function fastPushProjectCandidates(env: Env, input: { projectId: string; operationId?: string; items: ProjectCandidatePushItem[] }) {
  const projectId = collectorClean(input.projectId);
  const guard = await projectWriteGuard(env, projectId);
  if (!guard.ok) return guard;
  const project = guard.project as Record<string,unknown>;
  const operationId = collectorClean(input.operationId) || id("OP");
  await updateProjectWorkflow(env,{projectId,activate:["COLLECTOR_WORKING"],ownerId:"MCP_COLLECTOR",executionId:operationId,ttlSeconds:300,metadata:{source:"fast_push_project_candidates"}}).catch(()=>undefined);
  const created = nowMs();
  await env.DB.prepare(`INSERT OR IGNORE INTO v2_ingest_operations
    (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(operationId,"FAST_PUSH_PROJECT_CANDIDATES","QUEUED",0,0,0,JSON.stringify({projectId}),created,created).run();

  type ReservoirRow = {candidateId:string;url:string;projectId:string;itemId:string;universe:string;subject:string;tags:string[]};
  const rows: ReservoirRow[] = [];
  const itemResults = new Map<string,Record<string,unknown>>();
  let duplicatesSkipped = 0;

  for (const raw of (input.items || []).slice(0, 50)) {
    const requestedRef = collectorClean(raw.itemId);
    const item = await configureProjectItemPipeline(env, projectId, requestedRef, { targetCandidates: raw.targetCandidates, requiredApproved: raw.requiredApproved });
    if (!item) {
      itemResults.set(requestedRef,{ item_id: requestedRef, accepted: 0, error: "ITEM_UPSERT_FAILED" });
      continue;
    }
    const itemId = collectorClean(item.id), itemKey = collectorClean(item.item_key) || itemId;
    itemResults.set(itemId,{ item_id: itemId, item_key: itemKey, accepted: 0, target_candidates: Number(item.target_candidates || 8), required_approved: Number(item.required_approved || 1) });
    const normalized = collectorUniq((raw.urls || []).map(collectorClean).filter(Boolean)).slice(0, 50);
    for (const value of normalized) {
      const safe = safeRemoteUrl(value);
      if (!safe) continue;
      const url = safe.toString();
      const existing = await env.DB.prepare(`SELECT id,status FROM v2_ingest_candidates
        WHERE project_id=? AND item_id IN (?,?) AND source_url=? LIMIT 1`).bind(projectId, itemId, itemKey, url).first<Record<string,unknown>>();
      if (existing) { duplicatesSkipped++; continue; }
      const candidateId = await stableId("CAND",`PROJECT_ITEM_URL\n${projectId}\n${itemId}\n${url}`,12);
      rows.push({
        candidateId,
        url,
        projectId,
        itemId,
        universe: collectorClean(raw.universe) || collectorClean(item.universe),
        subject: collectorClean(raw.subject) || collectorClean(item.term),
        tags: Array.isArray(raw.tags) ? raw.tags.map(collectorClean).filter(Boolean).slice(0, 40) : [],
      });
      if (rows.length >= 500) break;
    }
    if (rows.length >= 500) break;
  }

  let inserted = 0;
  for (let offset=0; offset<rows.length; offset+=100) {
    const chunk=rows.slice(offset,offset+100);
    const results=await env.DB.batch(chunk.map(row=>env.DB.prepare(`INSERT OR IGNORE INTO v2_ingest_candidates
      (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,created_at,updated_at,discovered_at,queued_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(
        row.candidateId,operationId,row.url,row.projectId,row.itemId,row.universe,row.subject,JSON.stringify(row.tags),"DISCOVERED",created,created,created,
      )));
    for(let i=0;i<results.length;i++){
      const changed=Number(results[i]?.meta?.changes||0);
      if(changed>0){
        inserted+=changed;
        const current=itemResults.get(chunk[i].itemId);
        if(current) current.accepted=Number(current.accepted||0)+changed;
      } else duplicatesSkipped++;
    }
  }

  const activations: Array<Record<string,unknown>> = [];
  for (const item of itemResults.values()) {
    if (!item.item_id || item.error) continue;
    const activation = await activateProjectItemCandidateReserve(env,{projectId,itemId:collectorClean(item.item_id),operationId});
    activations.push({item_id:item.item_id,...activation});
  }
  const activated = activations.reduce((sum,row)=>sum+Number(row.activated||0),0);
  const operation = await env.DB.prepare("SELECT requested,succeeded,failed,status FROM v2_ingest_operations WHERE id=?").bind(operationId).first<{requested:number;succeeded:number;failed:number;status:string}>();
  const itemErrors=[...itemResults.values()].filter(item=>item.error);
  if (operation && Number(operation.requested||0)===0 && inserted===0 && itemErrors.length>0) {
    await env.DB.prepare("UPDATE v2_ingest_operations SET status='FAILED',error=?,updated_at=? WHERE id=?").bind(JSON.stringify(itemErrors),nowMs(),operationId).run();
    return {error:"NO_PROJECT_ITEMS_ACCEPTED",projectId,operationId,items:itemErrors,status:409} as const;
  }
  const operationCandidates = await env.DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='DISCOVERED' THEN 1 ELSE 0 END) AS standby,
      SUM(CASE WHEN status IN ('QUEUED','DOWNLOADING','RETRYING') THEN 1 ELSE 0 END) AS active
    FROM v2_ingest_candidates WHERE operation_id=?`).bind(operationId).first<Record<string,unknown>>();

  const states = await Promise.all([...itemResults.values()].filter(item => item.item_id && !item.error).map(item => refreshProjectItemPipelineState(env, projectId, collectorClean(item.item_id))));
  await syncDerivedProjectWorkflow(env,projectId).catch(()=>undefined);
  return {
    accepted: true,
    projectId,
    operationId,
    status: activated > 0 ? "ACCEPTED" : "COMPLETED",
    itemsAccepted: [...itemResults.values()].filter(item => Number(item.accepted || 0) > 0).length,
    candidatesAccepted: inserted,
    candidatesQueued: Number(operationCandidates?.active || 0),
    candidatesStandby: Number(operationCandidates?.standby || 0),
    activatedNow: activated,
    duplicatesSkipped,
    idempotent: inserted === 0,
    items: states.filter(Boolean),
    activations,
    httpStatus: 202,
  } as const;
}

async function projectItemStates(env: Env, projectId: string, itemRefs?: string[]) {
  let rows: Record<string, unknown>[] = [];
  if (itemRefs?.length) {
    for (const ref of collectorUniq(itemRefs.map(collectorClean).filter(Boolean)).slice(0, 100)) {
      const item = await resolveProjectItem(env, projectId, ref);
      if (item) rows.push(item);
    }
  } else {
    const result = await env.DB.prepare(`SELECT * FROM automatic_project_items WHERE project_id=?
      AND (target_candidates>0 OR discovered_count>0 OR collection_status<>'EMPTY') ORDER BY priority ASC,created_at ASC LIMIT 200`)
      .bind(projectId).all<Record<string,unknown>>();
    rows = result.results || [];
  }
  const states: ProjectPipelineItemState[] = [];
  for (const item of rows) {
    const state = await refreshProjectItemPipelineState(env, projectId, collectorClean(item.id));
    if (state) states.push(state);
  }
  return states;
}

export async function operationMaterializationTelemetry(env: Env, operationId: string) {
  const operation = await env.DB.prepare("SELECT id,type,status,requested,succeeded,failed,created_at,updated_at,error FROM v2_ingest_operations WHERE id=?")
    .bind(operationId).first<Record<string,unknown>>();
  if (!operation) return null;
  const candidates = await env.DB.prepare(`SELECT status,queue_wait_ms,download_ms,r2_write_ms,d1_finalize_ms,total_materialization_ms
    FROM v2_ingest_candidates WHERE operation_id=?`).bind(operationId).all<Record<string,unknown>>();
  const rows = candidates.results || [];
  const materialized = rows.filter(row => ["MATERIALIZED","APPROVED","REJECTED"].includes(collectorClean(row.status).toUpperCase())).length;
  const failed = rows.filter(row => collectorClean(row.status).toUpperCase() === "FAILED").length;
  const numeric = (key: string) => rows.map(row => Number(row[key] || 0)).filter(value => value > 0);
  const avg = (values: number[]) => values.length ? Math.round(values.reduce((a,b)=>a+b,0) / values.length) : 0;
  const p95 = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a,b)=>a-b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0;
  };
  const total = numeric("total_materialization_ms"), queueWait = numeric("queue_wait_ms");
  return {
    operationId,
    type: operation.type,
    status: operation.status,
    accepted: rows.length,
    queuedAttempts: Number(operation.requested || 0),
    standby: rows.filter(row => collectorClean(row.status).toUpperCase() === "DISCOVERED").length,
    materialized,
    failed,
    avgQueueWaitMs: avg(queueWait),
    avgMaterializationMs: avg(total),
    p95MaterializationMs: p95(total),
    avgDownloadMs: avg(numeric("download_ms")),
    avgR2WriteMs: avg(numeric("r2_write_ms")),
    avgD1FinalizeMs: avg(numeric("d1_finalize_ms")),
    createdAt: Number(operation.created_at || 0),
    updatedAt: Number(operation.updated_at || 0),
    error: operation.error || null,
  };
}

export async function getProjectCollectionSnapshot(env: Env, input: { projectId: string; operationId?: string; itemIds?: string[]; waitMs?: number }) {
  const projectId = collectorClean(input.projectId);
  const project = await env.DB.prepare("SELECT id,name,status,pipeline_status,state_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if (!project) return { error: "PROJECT_NOT_FOUND", status: 404 } as const;
  const deadline = Date.now() + Math.max(0, Math.min(Number(input.waitMs || 0), 5000));
  let states: ProjectPipelineItemState[] = [];
  let telemetry: Awaited<ReturnType<typeof operationMaterializationTelemetry>> = null;
  while (true) {
    states = await projectItemStates(env, projectId, input.itemIds);
    telemetry = input.operationId ? await operationMaterializationTelemetry(env, collectorClean(input.operationId)) : null;
    const active = states.some(item => item.collectionStatus === "COLLECTING");
    const operationActive = telemetry && ["QUEUED","PROCESSING"].includes(collectorClean(telemetry.status).toUpperCase());
    if ((!active && !operationActive) || Date.now() >= deadline) break;
    await collectorSleep(250);
  }
  return {
    project: { id: project.id, name: project.name, status: project.status, pipelineStatus: project.pipeline_status, stateVersion: Number(project.state_version || 0) },
    operation: telemetry,
    items: states.map(state => ({
      item_id: state.itemId,
      item_key: state.itemKey,
      target: state.targetCandidates,
      discovered: state.discovered,
      queued: state.queued,
      downloading: state.downloading,
      reserve: state.reserve,
      materialized: state.materialized,
      failed: state.failed,
      approved: state.approved,
      rejected: state.rejected,
      missing: state.missing,
      required_approved: state.requiredApproved,
      remaining_approved: state.remainingApproved,
      collection_status: state.collectionStatus,
      qa_status: state.qaStatus,
      status: state.collectionStatus === "COMPLETE" ? "READY_FOR_QA" : state.collectionStatus,
      requirement_status: state.requirementStatus,
    })),
    needsMore: states.filter(state => (state.collectionStatus === "NEEDS_MORE" || state.collectionStatus === "EMPTY") && state.reserve === 0).map(state => ({ item_id: state.itemId, item_key: state.itemKey, missing: state.missing || state.targetCandidates })),
  };
}

export async function getQaWorkPacket(request: Request, env: Env, input: { projectId?: string; limitItems?: number; candidatesPerItem?: number }) {
  const limitItems = Math.max(1, Math.min(Number(input.limitItems || 10), 30));
  const candidatesPerItem = Math.max(1, Math.min(Number(input.candidatesPerItem || 20), 50));
  const projectId = collectorClean(input.projectId);
  const where = projectId
    ? "WHERE i.project_id=? AND i.qa_status='READY_FOR_QA' AND COALESCE(p.mcp_locked,0)=0 AND COALESCE(p.lifecycle_status,'ACTIVE')='ACTIVE'"
    : "WHERE i.qa_status='READY_FOR_QA' AND COALESCE(p.mcp_locked,0)=0 AND COALESCE(p.lifecycle_status,'ACTIVE')='ACTIVE'";
  const sql = `SELECT i.id,i.project_id,i.item_key,i.term,i.context,i.kind,i.universe,i.notes,i.target_file,i.composition_class,i.semantic_class,i.semantic_reference,i.search_plan,
      i.target_candidates,i.required_approved,i.materialized_count,i.approved_count,i.rejected_count,i.collection_status,i.qa_status,i.priority,
      p.name AS project_name
    FROM automatic_project_items i JOIN automatic_projects p ON p.id=i.project_id ${where}
    ORDER BY i.priority ASC,i.qa_ready_at ASC,i.updated_at ASC LIMIT ?`;
  const result = projectId
    ? await env.DB.prepare(sql).bind(projectId, limitItems).all<Record<string,unknown>>()
    : await env.DB.prepare(sql).bind(limitItems).all<Record<string,unknown>>();
  const items: Record<string,unknown>[] = [];
  for (const item of result.results || []) {
    const candidates = await env.DB.prepare(`SELECT id,source_url,universe,subject,mime_type,size_bytes,updated_at
      FROM v2_ingest_candidates WHERE project_id=? AND item_id=? AND status='MATERIALIZED'
      ORDER BY materialized_at ASC,updated_at ASC LIMIT ?`)
      .bind(item.project_id, item.id, candidatesPerItem).all<Record<string,unknown>>();
    const materialization = await env.DB.prepare("SELECT script_reference,visual_reference,concept,subject,universe FROM materialization_items WHERE item_id=? ORDER BY updated_at DESC LIMIT 1")
      .bind(item.id).first<Record<string,unknown>>().catch(() => null);
    items.push({
      project: { project_id: item.project_id, name: item.project_name },
      item: {
        item_id: item.id,
        item_key: item.item_key,
        term: item.term,
        script_excerpt: materialization?.script_reference || item.context || null,
        visual_reference: materialization?.visual_reference || item.semantic_reference || null,
        concept: materialization?.concept || item.term,
        universe: materialization?.universe || item.universe || null,
        subject: materialization?.subject || item.term || null,
        requirements: {
          kind: item.kind,
          target_file: item.target_file,
          composition_class: item.composition_class,
          semantic_class: item.semantic_class,
          notes: item.notes,
          target_candidates: Number(item.target_candidates || 8),
          required_approved: Number(item.required_approved || 1),
          approved: Number(item.approved_count || 0),
        },
      },
      candidates: await Promise.all((candidates.results || []).map(async candidate => ({
        candidate_id: candidate.id,
        preview_url: await createSignedCandidateUrl(request, collectorClean(candidate.id), env, 900),
        mime: candidate.mime_type,
        size_bytes: Number(candidate.size_bytes || 0),
        width: null,
        height: null,
        source_url: candidate.source_url,
      }))),
    });
  }
  const qaProjects=collectorUniq(items.map(entry=>collectorClean((entry.project as Record<string,unknown>)?.project_id)).filter(Boolean));
  for(const qaProjectId of qaProjects) await updateProjectWorkflow(env,{projectId:qaProjectId,activate:["VISUAL_ANALYST_WORKING"],ownerId:"MCP_VISUAL_ANALYST",executionId:`qa-${nowMs()}`,ttlSeconds:300,metadata:{source:"get_qa_work_packet"}}).catch(()=>undefined);
  return { mode: "READY_FOR_QA_ONLY", count: items.length, items };
}

export async function submitQaDecisions(request: Request, env: Env, input: { decisions: Array<{ candidateId: string; decision: "APPROVE" | "REJECT"; observation?: string }> }) {
  const decisions = (input.decisions || []).slice(0, 100);
  const prepared: Array<{ candidateId:string; decision:"APPROVE"|"REJECT"; observation?:string; projectId:string; itemId:string }> = [];
  const results: Record<string,unknown>[] = [];
  for (const raw of decisions) {
    const candidateId = collectorClean(raw.candidateId);
    const candidate = await env.DB.prepare("SELECT id,project_id,item_id,status FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string,unknown>>();
    if (!candidate) { results.push({ candidate_id: candidateId, error: "NOT_FOUND" }); continue; }
    if (collectorClean(candidate.status).toUpperCase() !== "MATERIALIZED") { results.push({ candidate_id: candidateId, error: "NOT_MATERIALIZED", current_status: candidate.status }); continue; }
    const projectId = collectorClean(candidate.project_id), itemId = collectorClean(candidate.item_id);
    if (!projectId || !itemId) { results.push({ candidate_id: candidateId, error: "PROJECT_ITEM_REQUIRED" }); continue; }
    await markProjectItemQaInProgress(env, projectId, itemId);
    prepared.push({ candidateId, decision: raw.decision, observation: raw.observation, projectId, itemId });
  }

  for (let offset = 0; offset < prepared.length; offset += 10) {
    const chunk = prepared.slice(offset, offset + 10);
    const settled = await Promise.all(chunk.map(async entry => {
      if (entry.decision === "APPROVE") {
        const value = await approveCandidate(entry.candidateId, env);
        if ("error" in value) return { candidate_id: entry.candidateId, decision: entry.decision, ...value };
        return {
          candidate_id: entry.candidateId,
          decision: entry.decision,
          status: "APPROVED",
          asset_id: value.assetId,
          r2_key: value.r2Key,
          preview_url: await createSignedFileUrl(request, value.assetId, env, 900),
          incoming_deleted: value.incomingDeleted ?? true,
        };
      }
      const value = await rejectCandidate(entry.candidateId, env);
      return "error" in value
        ? { candidate_id: entry.candidateId, decision: entry.decision, ...value }
        : { candidate_id: entry.candidateId, decision: entry.decision, status: "REJECTED", incoming_deleted: value.incomingDeleted };
    }));
    results.push(...settled);
  }

  const pairs = collectorUniq(prepared.map(entry => `${entry.projectId}\n${entry.itemId}`));
  const itemStates: ProjectPipelineItemState[] = [];
  for (const pair of pairs) {
    const [projectId, itemId] = pair.split("\n");
    const state = await refreshProjectItemPipelineState(env, projectId, itemId);
    if (state) itemStates.push(state);
  }
  const approved = results.filter(row => row.status === "APPROVED").length;
  const rejected = results.filter(row => row.status === "REJECTED").length;
  const assetIds = results.map(row => collectorClean(row.asset_id)).filter(Boolean);
  const incomingDeleted = results.filter(row => row.incoming_deleted === true).length;
  return {
    approved,
    rejected,
    asset_ids: assetIds,
    incoming_deleted: incomingDeleted,
    results,
    items: itemStates.map(state => ({
      item_id: state.itemId,
      collection_status: state.collectionStatus,
      qa_status: state.qaStatus,
      approved: state.approved,
      rejected: state.rejected,
      required_approved: state.requiredApproved,
      remaining_requirements: { approved_needed: state.remainingApproved, status: state.requirementStatus },
    })),
  };
}
