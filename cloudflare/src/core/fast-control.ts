import type { CorvoQueueJob, Env, FastApproveJob, SupervisorDecisionsJob } from "../types";
import { id, nowMs, safeFilenameFromUrl, stableId } from "./ids";
import { reconcileAutomaticProject } from "./projects";

type Approval = { itemId?: string; targetFile?: string; candidateId: string; note?: string };
type Decision = { itemId: string; status: string; observation?: string };

function clean(value: unknown) { return String(value ?? "").trim(); }
function upper(value: unknown) { return clean(value).toUpperCase(); }
function jsonValue(value: unknown, fallback: unknown) { try { return typeof value === "string" ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } }

async function projectRow(env: Env, projectId: string) {
  return env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string, unknown>>();
}

async function resolveProjectItem(env: Env, projectId: string, selector: { itemId?: string; targetFile?: string }) {
  const project = await projectRow(env, projectId); if (!project) return null;
  const itemId = clean(selector.itemId), target = clean(selector.targetFile);
  if (!itemId && !target) return null;
  return env.DB.prepare(`SELECT * FROM automatic_project_items WHERE project_id=? AND version=? AND (
      id=? OR item_key=? OR target_file=? OR target_file=?
    ) ORDER BY CASE WHEN id=? THEN 0 WHEN item_key=? THEN 1 ELSE 2 END LIMIT 1`)
    .bind(projectId, Number(project.active_version || 1), itemId, itemId, itemId, target, itemId, itemId)
    .first<Record<string, unknown>>();
}

async function candidateMedia(env: Env, candidateId: string) {
  const fast = await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string, unknown>>();
  if (fast?.r2_key) return {
    source: "V2_FAST_PUSH", candidateId, r2Key: clean(fast.r2_key), mimeType: clean(fast.mime_type) || "application/octet-stream",
    sizeBytes: Number(fast.size_bytes || 0), assetId: clean(fast.asset_id) || null, sourceUrl: clean(fast.source_url) || null,
    universe: clean(fast.universe), subject: clean(fast.subject), tags: jsonValue(fast.tags_json, []) as unknown[], fileId: null as string | null,
  };
  const supervisor = await env.DB.prepare(`SELECT c.*,f.r2_key,f.mime_type,f.size_bytes,f.sha256,f.final_asset_id,m.tags,m.universe,m.subject,m.kind,m.target_name,mc.original_url
    FROM supervisor_project_candidates c
    LEFT JOIN materialization_files f ON f.id=c.materialization_file_id
    LEFT JOIN materialization_items m ON m.id=c.materialization_item_id
    LEFT JOIN materialization_candidates mc ON mc.id=COALESCE(c.materialization_candidate_id,f.candidate_id)
    WHERE c.id=? LIMIT 1`).bind(candidateId).first<Record<string, unknown>>();
  if (supervisor?.r2_key) return {
    source: "SUPERVISOR", candidateId, r2Key: clean(supervisor.r2_key), mimeType: clean(supervisor.mime_type) || "application/octet-stream",
    sizeBytes: Number(supervisor.size_bytes || 0), assetId: clean(supervisor.final_asset_id) || null, sourceUrl: clean(supervisor.original_url) || null,
    universe: clean(supervisor.universe), subject: clean(supervisor.subject), tags: jsonValue(supervisor.tags, []) as unknown[], fileId: clean(supervisor.materialization_file_id) || null,
  };
  const materialized = await env.DB.prepare(`SELECT f.*,m.tags,m.universe,m.subject,m.kind,m.target_name,c.original_url
    FROM materialization_files f
    LEFT JOIN materialization_items m ON m.id=f.item_db_id
    LEFT JOIN materialization_candidates c ON c.id=f.candidate_id
    WHERE f.candidate_id=? OR f.id=? LIMIT 1`).bind(candidateId,candidateId).first<Record<string, unknown>>();
  if (materialized?.r2_key) return {
    source: "MATERIALIZATION", candidateId, r2Key: clean(materialized.r2_key), mimeType: clean(materialized.mime_type) || "application/octet-stream",
    sizeBytes: Number(materialized.size_bytes || 0), assetId: clean(materialized.final_asset_id) || null, sourceUrl: clean(materialized.original_url) || null,
    universe: clean(materialized.universe), subject: clean(materialized.subject), tags: jsonValue(materialized.tags, []) as unknown[], fileId: clean(materialized.id) || null,
  };
  return null;
}

async function ensureAssetForCandidate(env: Env, projectId: string, item: Record<string, unknown>, candidate: NonNullable<Awaited<ReturnType<typeof candidateMedia>>>, note?: string) {
  if (candidate.assetId) {
    const existing = await env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(candidate.assetId).first<Record<string, unknown>>();
    if (existing) return existing;
  }

  const sourceObject = await env.MEDIA.get(candidate.r2Key);
  if (!sourceObject) throw new Error("R2_OBJECT_MISSING");

  // Candidate approvals are retried by Queue. A deterministic asset id makes the
  // D1/R2 promotion idempotent even if a Worker dies between R2.put and D1.batch.
  const assetId = await stableId("AST", `${candidate.source}\n${candidate.candidateId}`, 10);
  const deterministicExisting = await env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first<Record<string, unknown>>();
  if (deterministicExisting) {
    if (candidate.source === "V2_FAST_PUSH") {
      await env.DB.prepare("UPDATE v2_ingest_candidates SET asset_id=COALESCE(asset_id,?),updated_at=? WHERE id=?")
        .bind(assetId, nowMs(), candidate.candidateId).run();
    }
    return deterministicExisting;
  }

  const mime = candidate.mimeType || "application/octet-stream";
  const fallbackExt = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.startsWith("video/") ? (mime.split("/")[1] || "mp4") : "jpg";
  const preferredName = clean(item.target_file) || safeFilenameFromUrl(candidate.sourceUrl || "", `${assetId}.${fallbackExt}`);
  const originalName = preferredName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || `${assetId}.${fallbackExt}`;
  const tags = Array.isArray(candidate.tags) ? candidate.tags.map(String) : [];

  let finalKey = candidate.r2Key;
  // incoming/ is deliberately temporary. Promote FAST PUSH objects to the
  // canonical assets/ namespace before the catalog begins referencing them.
  if (candidate.source === "V2_FAST_PUSH" && candidate.r2Key.startsWith("incoming/")) {
    finalKey = `assets/${assetId}/${originalName}`;
    await env.MEDIA.put(finalKey, sourceObject.body, {
      httpMetadata: sourceObject.httpMetadata,
      customMetadata: { ...(sourceObject.customMetadata || {}), approvedFromCandidate: candidate.candidateId, assetId, projectId },
    });
  }

  const ts = nowMs();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT OR IGNORE INTO assets (id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,use_count,last_used_at,created_at,updated_at,subject,project_origin,script_reference,visual_reference,source_url,operational_note,qa_status)
      VALUES (?,?,?,?, 'Aprovado',?,?,?,?,?,0,NULL,?,?,?,?,?,?,?,?,'APROVADO')`)
      .bind(assetId, clean(item.term)||preferredName, clean(item.universe)||candidate.universe||"Sem universo", clean(item.kind)||"Imagem", JSON.stringify(tags), finalKey, originalName, mime, candidate.sizeBytes||Number(sourceObject.size||0), ts, ts, candidate.subject||null, projectId, clean(item.context)||null, clean(item.semantic_reference)||null, candidate.sourceUrl||null, note||null),
  ];
  if (candidate.source === "V2_FAST_PUSH") {
    statements.push(env.DB.prepare("UPDATE v2_ingest_candidates SET asset_id=?,r2_key=?,updated_at=? WHERE id=?")
      .bind(assetId, finalKey, ts, candidate.candidateId));
  }
  await env.DB.batch(statements);

  if (candidate.source === "V2_FAST_PUSH" && finalKey !== candidate.r2Key && candidate.r2Key.startsWith("incoming/")) {
    await env.MEDIA.delete(candidate.r2Key).catch(() => undefined);
  }
  return env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first<Record<string, unknown>>();
}

async function approveOne(env: Env, projectId: string, approval: Approval) {
  const item = await resolveProjectItem(env, projectId, approval); if (!item) throw new Error("PROJECT_ITEM_NOT_FOUND");
  const candidate = await candidateMedia(env, approval.candidateId); if (!candidate) throw new Error("CANDIDATE_NOT_MATERIALIZED");

  const alreadyLinkedId = clean(item.linked_asset_id);
  if (alreadyLinkedId) {
    const linked = await env.DB.prepare("SELECT id,r2_key FROM assets WHERE id=?").bind(alreadyLinkedId).first<Record<string, unknown>>();
    const sameCandidate = clean(candidate.assetId) === alreadyLinkedId || (linked && clean(linked.r2_key) === candidate.r2Key);
    if (sameCandidate) {
      if (candidate.source === "V2_FAST_PUSH") {
        await env.DB.prepare("UPDATE v2_ingest_candidates SET status='APPROVED',asset_id=?,updated_at=? WHERE id=?")
          .bind(alreadyLinkedId, nowMs(), approval.candidateId).run();
      }
      return { itemId: item.id, candidateId: approval.candidateId, assetId: alreadyLinkedId, status: clean(item.status) || "FROZEN", idempotent: true };
    }
    if (["FROZEN","APROVADO","APPROVED","COMPLETED","CONCLUIDO"].includes(upper(item.status))) {
      throw new Error("ITEM_ALREADY_FROZEN_DIFFERENT_ASSET");
    }
  }

  const asset = await ensureAssetForCandidate(env, projectId, item, candidate, approval.note); if (!asset) throw new Error("ASSET_CREATE_FAILED");
  const ts = nowMs(), assetId = clean(asset.id);

  // Guard a concurrent/retried approval after the asset promotion step.
  const current = await env.DB.prepare("SELECT status,linked_asset_id FROM automatic_project_items WHERE id=?").bind(item.id).first<Record<string, unknown>>();
  if (clean(current?.linked_asset_id)) {
    if (clean(current?.linked_asset_id) === assetId) return { itemId:item.id, candidateId:approval.candidateId, assetId, status:clean(current?.status)||"FROZEN", idempotent:true };
    throw new Error("ITEM_ALREADY_LINKED_DIFFERENT_ASSET");
  }

  const usageId = await stableId("USE", `${projectId}\n${clean(item.id)}\n${assetId}`, 10);
  const eventId = await stableId("PEV", `ITEM_FAST_APPROVED\n${projectId}\n${clean(item.id)}\n${assetId}`, 10);
  const statements:D1PreparedStatement[] = [
    env.DB.prepare("UPDATE automatic_project_items SET status='FROZEN',linked_asset_id=?,materialization_file_id=COALESCE(?,materialization_file_id),failure_reason=NULL,stage='COMPLETED',updated_at=? WHERE id=? AND linked_asset_id IS NULL").bind(assetId,candidate.fileId,ts,item.id),
    env.DB.prepare("INSERT OR IGNORE INTO asset_usage (id,asset_id,project,block,preset,slot,role,script_reference,note,status,used_at) VALUES (?,?,?,?,?,?,?,?,?,'Registrado',?)").bind(usageId,assetId,projectId,clean(item.item_key)||null,null,null,clean(item.kind)||null,clean(item.context)||null,approval.note||"FAST_APPROVE_PROJECT_ITEMS",ts),
    env.DB.prepare("UPDATE assets SET use_count=(SELECT COUNT(*) FROM asset_usage WHERE asset_id=?),last_used_at=(SELECT MAX(used_at) FROM asset_usage WHERE asset_id=?),updated_at=? WHERE id=?").bind(assetId,assetId,ts,assetId),
    env.DB.prepare("INSERT OR IGNORE INTO automatic_project_events (id,project_id,item_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?,?)").bind(eventId,projectId,item.id,"ITEM_FAST_APPROVED","FROZEN",JSON.stringify({candidateId:approval.candidateId,assetId}),ts),
  ];
  if (candidate.source === "V2_FAST_PUSH") statements.push(env.DB.prepare("UPDATE v2_ingest_candidates SET status='APPROVED',asset_id=?,updated_at=? WHERE id=?").bind(assetId,ts,approval.candidateId));
  if (candidate.source === "SUPERVISOR") statements.push(env.DB.prepare("UPDATE supervisor_project_candidates SET status='APPROVED',updated_at=? WHERE id=?").bind(ts,approval.candidateId));
  if (candidate.fileId) statements.push(env.DB.prepare("UPDATE materialization_files SET final_asset_id=? WHERE id=?").bind(assetId,candidate.fileId));
  if (item.materialization_item_id) statements.push(env.DB.prepare("UPDATE materialization_items SET status='FROZEN',frozen_asset_id=?,selected_file_id=COALESCE(?,selected_file_id),updated_at=? WHERE id=?").bind(assetId,candidate.fileId,ts,item.materialization_item_id));
  await env.DB.batch(statements);
  return { itemId: item.id, candidateId: approval.candidateId, assetId, status: "FROZEN" };
}

async function ensureOperation(env: Env, operationId: string, type: string, requested: number, projectId: string, payload: unknown) {
  const existing = await env.DB.prepare("SELECT * FROM v2_ingest_operations WHERE id=?").bind(operationId).first<Record<string, unknown>>();
  if (existing) {
    if (clean(existing.type) !== type) throw new Error(`OPERATION_ID_ALREADY_USED_BY:${clean(existing.type)}`);
    return { existing, created: false };
  }
  const ts=nowMs();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_ingest_operations (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at) VALUES (?,?, 'QUEUED',?,0,0,?,?,?)").bind(operationId,type,requested,JSON.stringify({projectId,payload}),ts,ts),
    env.DB.prepare("INSERT INTO v2_control_jobs (id,operation_id,kind,project_id,status,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'QUEUED',?,?,?)").bind(id("JOB"),operationId,type,projectId,JSON.stringify(payload),ts,ts),
  ]);
  return { existing: null, created: true };
}

export async function enqueueFastApproveProjectItems(env: Env, input:{projectId:string; approvals:Approval[]; operationId?:string}) {
  const projectId=clean(input.projectId); if(!await projectRow(env,projectId)) return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const approvals=input.approvals.filter(v=>clean(v.candidateId) && (clean(v.itemId)||clean(v.targetFile))).slice(0,100); if(!approvals.length)return {error:"NO_APPROVALS",status:400} as const;
  const operationId=clean(input.operationId)||id("OP"); const ensured=await ensureOperation(env,operationId,"FAST_APPROVE_PROJECT_ITEMS",approvals.length,projectId,{approvals});
  if(ensured.created) await env.MATERIALIZE_QUEUE.send({kind:"FAST_APPROVE_PROJECT_ITEMS",operationId,projectId,approvals} satisfies CorvoQueueJob);
  return {accepted:approvals.length,operationId,projectId,status:clean(ensured.existing?.status)||"QUEUED",idempotent:!ensured.created,httpStatus:202} as const;
}

export async function processFastApproveJob(env:Env,job:FastApproveJob){
  const ts=nowMs(); await env.DB.batch([env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=? AND status IN ('QUEUED','PROCESSING')").bind(ts,job.operationId),env.DB.prepare("UPDATE v2_control_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=? WHERE operation_id=? AND kind='FAST_APPROVE_PROJECT_ITEMS'").bind(ts,job.operationId)]);
  const results:unknown[]=[];let ok=0,failed=0;
  for(const approval of job.approvals){try{results.push(await approveOne(env,job.projectId,approval));ok++;}catch(error){failed++;results.push({itemId:approval.itemId||approval.targetFile,candidateId:approval.candidateId,error:error instanceof Error?error.message:String(error)});}}
  await reconcileAutomaticProject(env,job.projectId);
  const status=failed===0?"COMPLETED":ok>0?"PARTIAL":"FAILED",done=nowMs();
  await env.DB.batch([env.DB.prepare("UPDATE v2_ingest_operations SET status=?,succeeded=?,failed=?,error=?,updated_at=? WHERE id=?").bind(status,ok,failed,failed?`${failed} approval(s) failed`:null,done,job.operationId),env.DB.prepare("UPDATE v2_control_jobs SET status=?,result_json=?,error=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='FAST_APPROVE_PROJECT_ITEMS'").bind(status,JSON.stringify(results),failed?`${failed} approval(s) failed`:null,done,done,job.operationId)]);
  return {operationId:job.operationId,status,succeeded:ok,failed,results};
}

export async function enqueueSupervisorDecisions(env:Env,input:{projectId:string;decisions:Decision[];operationId?:string}){
  const projectId=clean(input.projectId);if(!await projectRow(env,projectId))return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const decisions=input.decisions.filter(v=>clean(v.itemId)&&clean(v.status)).slice(0,200);if(!decisions.length)return {error:"NO_DECISIONS",status:400} as const;
  const operationId=clean(input.operationId)||id("OP");const ensured=await ensureOperation(env,operationId,"SUPERVISOR_DECISIONS",decisions.length,projectId,{decisions});
  if(ensured.created)await env.MATERIALIZE_QUEUE.send({kind:"SUPERVISOR_DECISIONS",operationId,projectId,decisions} satisfies CorvoQueueJob);
  return {accepted:decisions.length,operationId,projectId,status:clean(ensured.existing?.status)||"QUEUED",idempotent:!ensured.created,httpStatus:202} as const;
}

async function activeCandidatesForItem(env:Env,projectId:string,item:Record<string,unknown>){
  const rows=await env.DB.prepare(`SELECT id,'SUPERVISOR' AS source FROM supervisor_project_candidates WHERE project_id=? AND item_id=? AND status IN ('PARA_ANALISE','PARA_QA_VISUAL','MATERIALIZED','READY_FOR_VISUAL_QA')
    UNION ALL SELECT id,'FAST_PUSH' AS source FROM v2_ingest_candidates WHERE project_id=? AND (item_id=? OR item_id=?) AND status IN ('MATERIALIZED','PENDING_ANALYSIS','QUEUED')`).bind(projectId,item.id,projectId,item.id,item.item_key).all<Record<string,unknown>>();
  return rows.results||[];
}

export async function enqueueApprovalsByItems(env:Env,input:{projectId:string;itemIds?:string[];targetFiles?:string[];reason?:string;operationId?:string}){
  const project=await projectRow(env,input.projectId);if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const selectors=[...(input.itemIds||[]).map(itemId=>({itemId})),...(input.targetFiles||[]).map(targetFile=>({targetFile}))].slice(0,100);const approvals:Approval[]=[];const ambiguous:unknown[]=[];
  for(const selector of selectors){const item=await resolveProjectItem(env,input.projectId,selector);if(!item){ambiguous.push({...selector,error:"PROJECT_ITEM_NOT_FOUND"});continue;}const candidates=await activeCandidatesForItem(env,input.projectId,item);if(candidates.length!==1){ambiguous.push({itemId:item.id,candidates:candidates.length,error:candidates.length?"AMBIGUOUS_REQUIRES_CANDIDATE_ID":"NO_ACTIVE_CANDIDATE"});continue;}approvals.push({itemId:clean(item.id),candidateId:clean(candidates[0].id),note:input.reason});}
  if(!approvals.length)return {accepted:0,ambiguous,status:"NO_APPROVALS_QUEUED"};
  const queued=await enqueueFastApproveProjectItems(env,{projectId:input.projectId,approvals,operationId:input.operationId});return {...queued,ambiguous};
}

export async function processSupervisorDecisionsJob(env:Env,job:SupervisorDecisionsJob){
  const start=nowMs();await env.DB.batch([env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=?").bind(start,job.operationId),env.DB.prepare("UPDATE v2_control_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=? WHERE operation_id=? AND kind='SUPERVISOR_DECISIONS'").bind(start,job.operationId)]);
  const results:unknown[]=[];let ok=0,failed=0;
  for(const d of job.decisions){try{const item=await resolveProjectItem(env,job.projectId,{itemId:d.itemId});if(!item)throw new Error("PROJECT_ITEM_NOT_FOUND");const status=upper(d.status);const ts=nowMs();if(["APROVADO","APPROVED"].includes(status)){const candidates=await activeCandidatesForItem(env,job.projectId,item);if(candidates.length!==1)throw new Error(candidates.length?"AMBIGUOUS_REQUIRES_CANDIDATE_ID":"NO_ACTIVE_CANDIDATE");results.push(await approveOne(env,job.projectId,{itemId:clean(item.id),candidateId:clean(candidates[0].id),note:d.observation}));}
      else if(["REJEITADO","REJECTED"].includes(status)){await env.DB.batch([env.DB.prepare("UPDATE automatic_project_items SET status='RELINK_REQUIRED',failure_reason=?,stage='RELINK',updated_at=? WHERE id=?").bind(d.observation||"REJECTED_BY_SUPERVISOR",ts,item.id),env.DB.prepare("UPDATE supervisor_project_candidates SET status='REJECTED',updated_at=? WHERE project_id=? AND item_id=? AND status NOT IN ('APPROVED','REJECTED')").bind(ts,job.projectId,item.id)]);results.push({itemId:item.id,status:"RELINK_REQUIRED"});}
      else if(["RELINK","RELINK_REQUIRED","RELINKAR"].includes(status)){await env.DB.prepare("UPDATE automatic_project_items SET status='RELINK_REQUIRED',failure_reason=?,stage='RELINK',updated_at=? WHERE id=?").bind(d.observation||"RELINK_REQUIRED",ts,item.id).run();results.push({itemId:item.id,status:"RELINK_REQUIRED"});}
      else if(["CORRECAO_TECNICA_PERMITIDA","TECHNICAL","TECHNICAL_QA"].includes(status)){await env.DB.prepare("UPDATE automatic_project_items SET status='TECHNICAL_QA',failure_reason=?,stage='TECHNICAL',updated_at=? WHERE id=?").bind(d.observation||null,ts,item.id).run();results.push({itemId:item.id,status:"TECHNICAL_QA"});}
      else throw new Error("UNSUPPORTED_DECISION");ok++;}catch(error){failed++;results.push({itemId:d.itemId,error:error instanceof Error?error.message:String(error)});}}
  await reconcileAutomaticProject(env,job.projectId);const status=failed===0?"COMPLETED":ok?"PARTIAL":"FAILED",done=nowMs();await env.DB.batch([env.DB.prepare("UPDATE v2_ingest_operations SET status=?,succeeded=?,failed=?,error=?,updated_at=? WHERE id=?").bind(status,ok,failed,failed?`${failed} decision(s) failed`:null,done,job.operationId),env.DB.prepare("UPDATE v2_control_jobs SET status=?,result_json=?,error=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='SUPERVISOR_DECISIONS'").bind(status,JSON.stringify(results),failed?`${failed} decision(s) failed`:null,done,done,job.operationId)]);return {operationId:job.operationId,status,succeeded:ok,failed,results};
}

export async function relinkProjectItems(env:Env,input:{projectId:string;itemIds?:string[];targetFiles?:string[];reason?:string;operationId?:string}){
  const selectors=[...(input.itemIds||[]).map(itemId=>({itemId})),...(input.targetFiles||[]).map(targetFile=>({targetFile}))].slice(0,200);const decisions:Decision[]=[];for(const selector of selectors){const item=await resolveProjectItem(env,input.projectId,selector);if(item)decisions.push({itemId:clean(item.id),status:"RELINK_REQUIRED",observation:input.reason});}return enqueueSupervisorDecisions(env,{projectId:input.projectId,decisions,operationId:input.operationId});
}

export async function rejectProjectItems(env:Env,input:{projectId:string;itemIds?:string[];targetFiles?:string[];reason?:string;operationId?:string}){
  const selectors=[...(input.itemIds||[]).map(itemId=>({itemId})),...(input.targetFiles||[]).map(targetFile=>({targetFile}))].slice(0,200);const decisions:Decision[]=[];for(const selector of selectors){const item=await resolveProjectItem(env,input.projectId,selector);if(item)decisions.push({itemId:clean(item.id),status:"REJECTED",observation:input.reason});}return enqueueSupervisorDecisions(env,{projectId:input.projectId,decisions,operationId:input.operationId});
}

export async function controlJobResult(env:Env,operationId:string){const operation=await env.DB.prepare("SELECT * FROM v2_ingest_operations WHERE id=?").bind(operationId).first<Record<string,unknown>>();if(!operation)return null;const job=await env.DB.prepare("SELECT * FROM v2_control_jobs WHERE operation_id=? ORDER BY created_at DESC LIMIT 1").bind(operationId).first<Record<string,unknown>>();return {...operation,job:job?{...job,payload:jsonValue(job.payload_json,{}),result:jsonValue(job.result_json,{})}:null};}
