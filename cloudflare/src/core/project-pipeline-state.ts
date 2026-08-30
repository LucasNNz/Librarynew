import type { Env } from "../types";
import { nowMs, stableId } from "./ids";
import { syncDerivedProjectWorkflow } from "./project-workflow";

function pipelineClean(value: unknown) { return String(value ?? "").trim(); }
function pipelineNumber(value: unknown) { return Number(value || 0); }

export type ProjectPipelineItemState = {
  projectId: string;
  itemId: string;
  itemKey: string;
  targetCandidates: number;
  requiredApproved: number;
  discovered: number;
  queued: number;
  downloading: number;
  reserve: number;
  materialized: number;
  failed: number;
  approved: number;
  rejected: number;
  missing: number;
  remainingApproved: number;
  collectionStatus: "EMPTY" | "COLLECTING" | "NEEDS_MORE" | "COMPLETE";
  qaStatus: "WAITING_COLLECTION" | "READY_FOR_QA" | "IN_QA" | "QA_COMPLETE";
  requirementStatus: "WAITING_COLLECTION" | "READY_FOR_QA" | "QA_IN_PROGRESS" | "QA_COMPLETE" | "NEEDS_RELINK";
};

export async function resolveProjectItem(env: Env, projectId: string, itemRef: string) {
  const ref = pipelineClean(itemRef);
  if (!projectId || !ref) return null;
  return env.DB.prepare(`SELECT * FROM automatic_project_items
    WHERE project_id=? AND (id=? OR item_key=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`)
    .bind(projectId, ref, ref, ref).first<Record<string, unknown>>();
}

export async function configureProjectItemPipeline(env: Env, projectId: string, itemRef: string, input: { targetCandidates?: number; requiredApproved?: number }): Promise<Record<string, unknown> | null> {
  let item = await resolveProjectItem(env, projectId, itemRef);
  const project = await env.DB.prepare("SELECT id,active_version FROM automatic_projects WHERE id=?").bind(projectId).first<{id:string;active_version:number}>();
  if (!project) return null;
  const ref = pipelineClean(itemRef);
  if (!ref) return null;
  if (!item) {
    const ts=nowMs();
    const itemId=await stableId("PITEM",`PROJECT_SCENE\n${projectId}\n${ref}`,12);
    const target=Math.max(1,Math.min(Number(input.targetCandidates??8),100));
    const required=Math.max(1,Math.min(Number(input.requiredApproved??1),target));
    await env.DB.prepare(`INSERT OR IGNORE INTO automatic_project_items
      (id,project_id,version,item_key,term,context,kind,status,priority,created_at,updated_at,target_candidates,required_approved,collection_status,qa_status,stage,strategy_state,composition_class)
      VALUES (?,?,?,?,?,NULL,'contextual','COLLECTING',1,?,?,?,?,'EMPTY','WAITING_COLLECTION','DISCOVERY','{}','CONTEXTUAL')`)
      .bind(itemId,projectId,Number(project.active_version||1),ref,ref,ts,ts,target,required).run();
    item=await resolveProjectItem(env,projectId,ref);
  }
  if (!item) return null;
  const target = Math.max(1, Math.min(Number(input.targetCandidates ?? item.target_candidates ?? 8), 100));
  const required = Math.max(1, Math.min(Number(input.requiredApproved ?? item.required_approved ?? 1), target));
  await env.DB.prepare("UPDATE automatic_project_items SET target_candidates=?,required_approved=?,status=CASE WHEN upper(status) IN ('PARSING','PENDING') THEN 'COLLECTING' ELSE status END,updated_at=? WHERE id=?")
    .bind(target, required, nowMs(), item.id).run();
  await env.DB.prepare("UPDATE automatic_projects SET total_items=(SELECT COUNT(*) FROM automatic_project_items WHERE project_id=?),state_version=state_version+1,updated_at=? WHERE id=?")
    .bind(projectId,nowMs(),projectId).run();
  return { ...item, target_candidates: target, required_approved: required };
}

export async function refreshProjectItemPipelineState(env: Env, projectId?: string | null, itemRef?: string | null): Promise<ProjectPipelineItemState | null> {
  const project = pipelineClean(projectId), ref = pipelineClean(itemRef);
  if (!project || !ref) return null;
  const item = await resolveProjectItem(env, project, ref);
  if (!item) return null;
  const itemId = pipelineClean(item.id), itemKey = pipelineClean(item.item_key) || itemId;
  const counts = await env.DB.prepare(`SELECT
      COUNT(*) AS discovered,
      SUM(CASE WHEN status IN ('QUEUED','RETRYING') THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='DOWNLOADING' THEN 1 ELSE 0 END) AS downloading,
      SUM(CASE WHEN status='DISCOVERED' THEN 1 ELSE 0 END) AS reserve,
      SUM(CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN 1 ELSE 0 END) AS materialized,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status='MATERIALIZED' THEN 1 ELSE 0 END) AS available_for_qa
    FROM v2_ingest_candidates
    WHERE project_id=? AND item_id IN (?,?)`)
    .bind(project, itemId, itemKey).first<Record<string, unknown>>();

  const targetCandidates = Math.max(1, pipelineNumber(item.target_candidates) || 8);
  const requiredApproved = Math.max(1, pipelineNumber(item.required_approved) || 1);
  const discovered = pipelineNumber(counts?.discovered), queued = pipelineNumber(counts?.queued), downloading = pipelineNumber(counts?.downloading), reserve = pipelineNumber(counts?.reserve);
  const materialized = pipelineNumber(counts?.materialized), failed = pipelineNumber(counts?.failed), approved = pipelineNumber(counts?.approved), rejected = pipelineNumber(counts?.rejected);
  const availableForQa = pipelineNumber(counts?.available_for_qa);
  const missing = Math.max(0, targetCandidates - materialized);
  const remainingApproved = Math.max(0, requiredApproved - approved);

  let collectionStatus: ProjectPipelineItemState["collectionStatus"];
  if (materialized >= targetCandidates) collectionStatus = "COMPLETE";
  else if (queued + downloading + reserve > 0) collectionStatus = "COLLECTING";
  else if (discovered === 0) collectionStatus = "EMPTY";
  else collectionStatus = "NEEDS_MORE";

  const priorQa = pipelineClean(item.qa_status).toUpperCase();
  let qaStatus: ProjectPipelineItemState["qaStatus"] = ["READY_FOR_QA","IN_QA","QA_COMPLETE"].includes(priorQa)
    ? priorQa as ProjectPipelineItemState["qaStatus"] : "WAITING_COLLECTION";
  if (approved >= requiredApproved) qaStatus = "QA_COMPLETE";
  else if (qaStatus === "WAITING_COLLECTION" && collectionStatus === "COMPLETE") qaStatus = "READY_FOR_QA";

  let requirementStatus: ProjectPipelineItemState["requirementStatus"];
  if (qaStatus === "QA_COMPLETE") requirementStatus = "QA_COMPLETE";
  else if (qaStatus === "IN_QA" && remainingApproved > 0 && availableForQa === 0) requirementStatus = "NEEDS_RELINK";
  else if (qaStatus === "IN_QA") requirementStatus = "QA_IN_PROGRESS";
  else if (qaStatus === "READY_FOR_QA") requirementStatus = "READY_FOR_QA";
  else requirementStatus = "WAITING_COLLECTION";

  const ts = nowMs();
  const qaReadyAt = qaStatus === "READY_FOR_QA" ? Number(item.qa_ready_at || ts) : item.qa_ready_at || null;
  const qaCompletedAt = qaStatus === "QA_COMPLETE" ? Number(item.qa_completed_at || ts) : item.qa_completed_at || null;
  await env.DB.prepare(`UPDATE automatic_project_items SET
      discovered_count=?,queued_count=?,downloading_count=?,materialized_count=?,failed_count=?,approved_count=?,rejected_count=?,
      collection_status=?,qa_status=?,qa_ready_at=?,qa_completed_at=?,updated_at=? WHERE id=?`)
    .bind(discovered, queued, downloading, materialized, failed, approved, rejected, collectionStatus, qaStatus, qaReadyAt, qaCompletedAt, ts, itemId).run();
  await syncDerivedProjectWorkflow(env,project).catch(()=>undefined);

  return { projectId: project, itemId, itemKey, targetCandidates, requiredApproved, discovered, queued, downloading, reserve, materialized, failed, approved, rejected, missing, remainingApproved, collectionStatus, qaStatus, requirementStatus };
}

export async function markProjectItemQaInProgress(env: Env, projectId: string, itemRef: string) {
  const item = await resolveProjectItem(env, projectId, itemRef);
  if (!item) return null;
  const current = pipelineClean(item.qa_status).toUpperCase();
  if (current === "QA_COMPLETE") return item;
  const ts = nowMs();
  await env.DB.prepare("UPDATE automatic_project_items SET qa_status='IN_QA',qa_started_at=COALESCE(qa_started_at,?),updated_at=? WHERE id=?")
    .bind(ts, ts, item.id).run();
  return { ...item, qa_status: "IN_QA", qa_started_at: item.qa_started_at || ts };
}
