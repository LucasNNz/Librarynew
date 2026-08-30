import type { Env } from "../types";
import { id, nowMs } from "./ids";
import { expireProjectWorkflowTags, projectIsClosed, projectSlotSnapshot, projectWriteGuard, setProjectLifecycle } from "./project-workflow";
import { materializeScenesFromProjectScript } from "./project-script-parser";

function encodeCursor(updatedAt: number, projectId: string) {
  return btoa(JSON.stringify([updatedAt, projectId])).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function decodeCursor(value?: string | null) {
  if (!value) return null;
  try { const raw=value.replace(/-/g,"+").replace(/_/g,"/"); const [updatedAt,projectId]=JSON.parse(atob(raw+"=".repeat((4-raw.length%4)%4))); return {updatedAt:Number(updatedAt),projectId:String(projectId)}; } catch { return null; }
}

export async function listAutomaticProjects(env: Env, limit=50, cursorValue?: string | null) {
  const safe=Math.max(1,Math.min(limit,200)); const cursor=decodeCursor(cursorValue); const values:unknown[]=[]; let where="";
  if(cursor){where=" WHERE (updated_at < ? OR (updated_at = ? AND id < ?))"; values.push(cursor.updatedAt,cursor.updatedAt,cursor.projectId);}
  await expireProjectWorkflowTags(env).catch(()=>undefined);
  const result=await env.DB.prepare(`SELECT id,name,status,pipeline_status,next_action,project_domain,queue_priority,state_version,total_items,approved_count,pending_count,failed_count,created_at,updated_at,completed_at,lifecycle_status,mcp_locked,rejected_at,closed_reason,workflow_updated_at FROM automatic_projects${where} ORDER BY updated_at DESC,id DESC LIMIT ?`).bind(...values,safe+1).all<Record<string,unknown>>();
  const rows=result.results||[]; const hasMore=rows.length>safe; const items=rows.slice(0,safe); const last=items[items.length-1];
  if(items.length){
    const placeholders=items.map(()=>"?").join(",");
    const tagRows=await env.DB.prepare(`SELECT project_id,tag,owner_id,execution_id,last_seen_at,lease_expires_at FROM v2_project_workflow_tags WHERE status='ACTIVE' AND project_id IN (${placeholders}) ORDER BY updated_at DESC`).bind(...items.map(row=>row.id)).all<Record<string,unknown>>();
    const byProject=new Map<string,Record<string,unknown>[]>(); for(const row of tagRows.results||[]){const key=String(row.project_id);byProject.set(key,[...(byProject.get(key)||[]),row]);}
    for(const item of items)(item as any).workflow_tags=byProject.get(String(item.id))||[];
  }
  return {items,nextCursor:hasMore&&last?encodeCursor(Number(last.updated_at),String(last.id)):null};
}

export async function createAutomaticProject(env: Env, input: { projeto_id?:string; nome:string; project_domain?:string; prioridade_fila?:number; automatico?:boolean; biblioteca_primeiro?:boolean; busca_externa?:boolean; zip_automatico?:boolean; excluir_zip_ao_concluir?:boolean }) {
  const projectId=input.projeto_id?.trim()||id("PROJ");
  const existing=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(existing)return {project:existing,idempotent:true};
  const ts=nowMs();
  await env.DB.prepare(`INSERT INTO automatic_projects (
    id,name,status,automatic,library_first,external_search,parallel_materialization,automatic_technical_qa,automatic_zip,delete_zip_on_complete,circuit_breaker,
    active_version,created_at,updated_at,pipeline_status,project_domain,queue_priority,state_version,total_items,approved_count,frozen_count,collecting_count,materializing_count,waiting_qa_count,relink_count,technical_count,waiting_seed_count,failed_count,pending_count
  ) VALUES (?,?, 'WAITING_FILES', ?,?,?,1,1,?,?,1,1,?,?,'AGUARDANDO',?,?,1,0,0,0,0,0,0,0,0,0,0,0)`)
    .bind(projectId,input.nome.trim(),input.automatico===false?0:1,input.biblioteca_primeiro===false?0:1,input.busca_externa===false?0:1,input.zip_automatico===false?0:1,input.excluir_zip_ao_concluir===false?0:1,ts,ts,input.project_domain?.trim()||"GENERAL",Number(input.prioridade_fila||1)).run();
  return {project:await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>(),idempotent:false};
}

export async function getAutomaticProject(env: Env, projectId:string) {
  return env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
}

export async function getAutomaticProjectDetails(env: Env, projectId:string) {
  const project=await getAutomaticProject(env,projectId); if(!project)return null;
  const [files,items,events]=await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT * FROM automatic_project_files WHERE project_id=? ORDER BY created_at DESC LIMIT 200").bind(projectId),
    env.DB.prepare("SELECT * FROM automatic_project_items WHERE project_id=? ORDER BY priority DESC,updated_at DESC LIMIT 1000").bind(projectId),
    env.DB.prepare("SELECT * FROM automatic_project_events WHERE project_id=? ORDER BY created_at DESC LIMIT 500").bind(projectId),
  ]);
  return {project,files:files.results||[],items:items.results||[],events:events.results||[]};
}

export async function getOperationalSnapshot(env: Env, projectId:string, sinceVersion?:number) {
  const project=await getAutomaticProject(env,projectId); if(!project)return null;
  const version=Number(project.state_version||1);
  if(sinceVersion!=null&&Number(sinceVersion)===version)return {project_id:projectId,state_version:version,changed:false};
  const attachmentSummary=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM automatic_project_files WHERE project_id=?) AS project_files,
    (SELECT COUNT(*) FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT') AS scripts,
    (SELECT COUNT(*) FROM automatic_project_files WHERE project_id=? AND upper(role)='REQUIREMENTS') AS requirements,
    (SELECT COUNT(*) FROM automatic_project_files WHERE project_id=? AND upper(role) IN ('REFERENCES','REFERENCIAS','REFERENCE_BRIEF','IMAGENS_NECESSARIAS','IMAGENS NECESSARIAS')) AS references,
    (SELECT COUNT(*) FROM v2_ingest_candidates WHERE project_id=? AND r2_key IS NOT NULL) AS collected_files,
    (SELECT COUNT(*) FROM v2_project_media WHERE project_id=? AND r2_key IS NOT NULL) AS project_media,
    (SELECT COUNT(*) FROM v2_download_packages WHERE project_id=? AND r2_key IS NOT NULL) AS packages`).bind(projectId,projectId,projectId,projectId,projectId,projectId,projectId).first<Record<string,unknown>>();
  const projectFiles=Number(attachmentSummary?.project_files||0);
  const collectedFiles=Number(attachmentSummary?.collected_files||0);
  const projectMedia=Number(attachmentSummary?.project_media||0);
  const packages=Number(attachmentSummary?.packages||0);
  return {
    project_id:projectId,state_version:version,changed:true,status:project.status,pipeline_status:project.pipeline_status,next_action:project.next_action,
    counts:{ total:Number(project.total_items||0),approved:Number(project.approved_count||0),pending:Number(project.pending_count||0),failed:Number(project.failed_count||0),collecting:Number(project.collecting_count||0),materializing:Number(project.materializing_count||0),waiting_qa:Number(project.waiting_qa_count||0),relink:Number(project.relink_count||0),technical:Number(project.technical_count||0),frozen:Number(project.frozen_count||0) },
    attachments:{project_files:projectFiles,scripts:Number(attachmentSummary?.scripts||0),references:Number(attachmentSummary?.references||0),requirements:Number(attachmentSummary?.requirements||0),collected_files:collectedFiles,project_media:projectMedia,packages,total_visible:projectFiles+collectedFiles+projectMedia+packages,visibility:"MCP_IMMEDIATE_AFTER_D1_COMMIT"},
    lease:{status:project.supervisor_status,execution_id:project.supervisor_execution_id,expires_at:project.supervisor_lease_expires_at,last_seen_at:project.supervisor_last_seen_at},
    updated_at:project.updated_at,
  };
}

const terminalItemStates = new Set(["APROVADO","APPROVED","CONCLUIDO","CONCLUÍDO","FROZEN","CONGELADO","FAILED","FALHOU","CANCELADO"]);

function workerStageForItem(statusValue: unknown) {
  const status = String(statusValue || "").toUpperCase();
  if (["MATERIALIZANDO","MATERIALIZING","MATERIALIZATION"].includes(status)) return { stage: "MATERIALIZATION", workerType: "MATERIALIZATION" };
  if (["AGUARDANDO_QA","PARA_ANALISE","QA","WAITING_QA"].includes(status)) return { stage: "QA", workerType: "QA" };
  if (["RELINK","RELINK_REQUIRED","RELINKAR"].includes(status)) return { stage: "RELINK", workerType: "RELINK" };
  if (["TECNICO","TECHNICAL","TECHNICAL_QA"].includes(status)) return { stage: "TECHNICAL", workerType: "TECHNICAL" };
  return { stage: "DISCOVERY", workerType: "DISCOVERY" };
}

export async function configureAutomaticProject(env: Env, projectId: string, input: { automatico?:boolean; biblioteca_primeiro?:boolean; busca_externa?:boolean; zip_automatico?:boolean; excluir_zip_ao_concluir?:boolean; dominio?:string; prioridade_fila?:number; status?:string; pipeline_status?:string; next_action?:string|null }) {
  const project = await getAutomaticProject(env, projectId); if (!project) return null;
  if(projectIsClosed(project)) return {error:"PROJECT_LOCKED",projectId,lifecycleStatus:project.lifecycle_status||project.status,explicitReopenRequired:true,statusCode:409};
  const next = {
    automatic: input.automatico === undefined ? Number(project.automatic || 0) : (input.automatico ? 1 : 0),
    libraryFirst: input.biblioteca_primeiro === undefined ? Number(project.library_first || 0) : (input.biblioteca_primeiro ? 1 : 0),
    externalSearch: input.busca_externa === undefined ? Number(project.external_search || 0) : (input.busca_externa ? 1 : 0),
    automaticZip: input.zip_automatico === undefined ? Number(project.automatic_zip || 0) : (input.zip_automatico ? 1 : 0),
    deleteZip: input.excluir_zip_ao_concluir === undefined ? Number(project.delete_zip_on_complete || 0) : (input.excluir_zip_ao_concluir ? 1 : 0),
    domain: input.dominio?.trim() || String(project.project_domain || "GENERAL"),
    priority: input.prioridade_fila === undefined ? Number(project.queue_priority || 1) : Math.max(1, Math.min(input.prioridade_fila, 100)),
    status: input.status?.trim() || String(project.status || "WAITING_FILES"),
    pipeline: input.pipeline_status?.trim() || String(project.pipeline_status || "AGUARDANDO"),
    nextAction: input.next_action === undefined ? (project.next_action ?? null) : input.next_action,
  };
  const ts = nowMs();
  await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`UPDATE automatic_projects SET automatic=?,library_first=?,external_search=?,automatic_zip=?,delete_zip_on_complete=?,project_domain=?,queue_priority=?,status=?,pipeline_status=?,next_action=?,state_version=state_version+1,updated_at=? WHERE id=?`)
      .bind(next.automatic,next.libraryFirst,next.externalSearch,next.automaticZip,next.deleteZip,next.domain,next.priority,next.status,next.pipeline,next.nextAction,ts,projectId),
    env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id("PEV"),projectId,"CONFIG_UPDATED",next.pipeline,JSON.stringify(next),ts),
  ]);
  return getAutomaticProject(env, projectId);
}

export async function reconcileAutomaticProject(env: Env, projectId: string) {
  const project = await getAutomaticProject(env, projectId); if (!project) return null;
  if(projectIsClosed(project)) return {error:"PROJECT_LOCKED",projectId,lifecycleStatus:project.lifecycle_status||project.status,explicitReopenRequired:true};

  // Recovery invariant: a stored SCRIPT must never remain invisible to the pipeline.
  // If an older project has SCRIPT READY but no scenes/items, parse the latest text script
  // before computing project state. This repairs pre-0.20.30 projects idempotently.
  let scriptRecovery:Record<string,unknown>|null=null;
  const currentItemCount=await env.DB.prepare("SELECT COUNT(*) AS count FROM automatic_project_items WHERE project_id=?").bind(projectId).first<{count:number}>();
  if(Number(currentItemCount?.count||0)===0){
    const script=await env.DB.prepare("SELECT id,file_name,r2_key,mime_type,size_bytes FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>();
    if(script?.r2_key && Number(script.size_bytes||0)<=2*1024*1024){
      const mime=String(script.mime_type||"").toLowerCase();
      if(!mime || mime.startsWith("text/") || mime.includes("json")){
        const object=await env.MEDIA.get(String(script.r2_key));
        if(object){
          const content=await object.text();
          scriptRecovery=await materializeScenesFromProjectScript(env,{projectId,content,fileId:String(script.id||""),fileName:String(script.file_name||"SCRIPT.txt")}).catch(error=>({ok:false,error:error instanceof Error?error.message:String(error)}));
        }
      }
    }
  }
  if(scriptRecovery && Number((scriptRecovery as any)?.sceneCount||0)===0){
    return { project:await getAutomaticProject(env,projectId), counts:{total:0,approved:0,frozen:0,collecting:0,materializing:0,waitingQa:0,relink:0,technical:0,waitingSeed:0,failed:0,pending:0}, createdWorkItems:0, scriptRecovery };
  }

  const itemsResult = await env.DB.prepare("SELECT * FROM automatic_project_items WHERE project_id=? ORDER BY priority DESC,created_at ASC").bind(projectId).all<Record<string,unknown>>();
  const items = itemsResult.results || [];
  const counts = { total:items.length, approved:0, frozen:0, collecting:0, materializing:0, waitingQa:0, relink:0, technical:0, waitingSeed:0, failed:0, pending:0 };
  const statements:D1PreparedStatement[] = [];
  const ts = nowMs();
  for (const item of items) {
    const status = String(item.status || "").toUpperCase();
    if (["APROVADO","APPROVED","CONCLUIDO","CONCLUÍDO"].includes(status)) counts.approved++;
    else if (["FROZEN","CONGELADO"].includes(status)) counts.frozen++;
    else if (["COLETANDO","COLLECTING"].includes(status)) counts.collecting++;
    else if (["MATERIALIZANDO","MATERIALIZING","MATERIALIZATION"].includes(status)) counts.materializing++;
    else if (["AGUARDANDO_QA","PARA_ANALISE","QA","WAITING_QA"].includes(status)) counts.waitingQa++;
    else if (["RELINK","RELINK_REQUIRED","RELINKAR"].includes(status)) counts.relink++;
    else if (["TECNICO","TECHNICAL","TECHNICAL_QA"].includes(status)) counts.technical++;
    else if (["WAITING_SEED","AGUARDANDO_SEED"].includes(status)) counts.waitingSeed++;
    else if (["FAILED","FALHOU","ERRO"].includes(status)) counts.failed++;
    else counts.pending++;

    if (!terminalItemStates.has(status)) {
      const existing = await env.DB.prepare("SELECT id,status FROM worker_work_items WHERE project_id=? AND item_id=? AND status IN ('READY','LEASED') LIMIT 1").bind(projectId,item.id).first<Record<string,unknown>>();
      if (!existing) {
        const {stage,workerType}=workerStageForItem(status);
        const ready = Number(item.stage_ready_at || item.updated_at || ts);
        const original = Number(item.original_ready_at || item.created_at || ready);
        statements.push(env.DB.prepare(`INSERT INTO worker_work_items (id,scope_type,scope_id,project_id,project_domain,item_id,stage,worker_type,priority,resume_priority,status,ready_at,original_ready_at,attempts,last_action,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,'READY',?,?,0,'RECONCILE',?, ?,?)`)
          .bind(id("WORK"),"PROJECT_ITEM",String(item.id),projectId,String(project.project_domain||"GENERAL"),String(item.id),stage,workerType,Number(item.priority||1),ready,original,JSON.stringify({term:item.term,universe:item.universe,target_file:item.target_file}),ts,ts));
      }
    }
  }
  if (statements.length) {
    for (let offset=0; offset<statements.length; offset+=50) await env.DB.batch(statements.slice(offset,offset+50));
  }
  const completed = counts.total>0 && counts.approved+counts.frozen>=counts.total;
  const pipeline = completed ? "CONCLUIDO" : counts.failed>0 ? "ATENCAO" : "PROCESSANDO";
  const status = completed ? "COMPLETED" : String(project.status)==="WAITING_FILES" && counts.total===0 ? "WAITING_FILES" : "ACTIVE";
  await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`UPDATE automatic_projects SET status=?,pipeline_status=?,next_action=?,total_items=?,approved_count=?,frozen_count=?,collecting_count=?,materializing_count=?,waiting_qa_count=?,relink_count=?,technical_count=?,waiting_seed_count=?,failed_count=?,pending_count=?,completed_at=?,state_version=state_version+1,updated_at=? WHERE id=?`)
      .bind(status,pipeline,completed?null:"DISPATCH",counts.total,counts.approved,counts.frozen,counts.collecting,counts.materializing,counts.waitingQa,counts.relink,counts.technical,counts.waitingSeed,counts.failed,counts.pending,completed?ts:null,ts,projectId),
    env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id("PEV"),projectId,"RECONCILED",pipeline,JSON.stringify({counts,createdWorkItems:statements.length}),ts),
  ]);
  return { project: await getAutomaticProject(env,projectId), counts, createdWorkItems: statements.length, scriptRecovery };
}

export async function processAutomaticProject(env: Env, projectId: string) {
  const project = await getAutomaticProject(env,projectId); if(!project)return null;
  if(projectIsClosed(project)) return {error:"PROJECT_LOCKED",projectId,lifecycleStatus:project.lifecycle_status||project.status,explicitReopenRequired:true};
  const ts=nowMs();
  await env.DB.prepare("UPDATE automatic_projects SET status='ACTIVE',pipeline_status='PROCESSANDO',started_at=COALESCE(started_at,?),next_action='DISPATCH',state_version=state_version+1,updated_at=? WHERE id=?")
    .bind(ts,ts,projectId).run();
  return reconcileAutomaticProject(env,projectId);
}

export async function validateProjectConsistency(env: Env, projectId:string) {
  const project=await getAutomaticProject(env,projectId); if(!project)return null;
  const [items,files,work] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT i.id,i.status,i.linked_asset_id,a.id AS asset_exists,a.r2_key FROM automatic_project_items i LEFT JOIN assets a ON a.id=i.linked_asset_id WHERE i.project_id=?`).bind(projectId),
    env.DB.prepare("SELECT id,role,file_name,r2_key FROM automatic_project_files WHERE project_id=?").bind(projectId),
    env.DB.prepare("SELECT status,COUNT(*) AS count FROM worker_work_items WHERE project_id=? GROUP BY status").bind(projectId),
  ]);
  const itemRows=items.results||[]; const fileRows=files.results||[];
  const brokenLinks=itemRows.filter(row=>row.linked_asset_id && !row.asset_exists).map(row=>({itemId:row.id,assetId:row.linked_asset_id}));
  const missingAssetObjects=[] as Array<{itemId:unknown;assetId:unknown;r2Key:unknown}>;
  for(const row of itemRows){ if(row.asset_exists && row.r2_key && !(await env.MEDIA.head(String(row.r2_key)))) missingAssetObjects.push({itemId:row.id,assetId:row.asset_exists,r2Key:row.r2_key}); }
  const missingProjectFiles=[] as Array<{fileId:unknown;role:unknown;r2Key:unknown}>;
  for(const row of fileRows){ if(row.r2_key && !(await env.MEDIA.head(String(row.r2_key)))) missingProjectFiles.push({fileId:row.id,role:row.role,r2Key:row.r2_key}); }
  return {ok:brokenLinks.length===0&&missingAssetObjects.length===0&&missingProjectFiles.length===0,projectId,items:itemRows.length,files:fileRows.length,brokenLinks,missingAssetObjects,missingProjectFiles,workerStates:work.results||[]};
}

export async function reopenAutomaticProject(env: Env, projectId:string, reason?:string) {
  const project=await getAutomaticProject(env,projectId); if(!project)return null;
  await setProjectLifecycle(env,{projectIds:[projectId],action:"REOPEN",reason:reason||"EXPLICIT_USER_REOPEN"});
  return getAutomaticProject(env,projectId);
}

export async function projectAvailability(env: Env, projectId:string) {
  const project=await getAutomaticProject(env,projectId); if(!project)return {available:false,error:"NOT_FOUND"};
  const activeLease=await env.DB.prepare("SELECT COUNT(*) AS count FROM worker_work_items WHERE project_id=? AND status='LEASED' AND lease_expires_at>? ").bind(projectId,nowMs()).first<{count:number}>();
  return {available:!projectIsClosed(project),projectId,status:project.status,pipelineStatus:project.pipeline_status,lifecycleStatus:project.lifecycle_status||"ACTIVE",mcpLocked:projectIsClosed(project),explicitReopenRequired:projectIsClosed(project),activeLeases:Number(activeLease?.count||0),stateVersion:Number(project.state_version||1),updatedAt:project.updated_at};
}

export async function projectLog(env: Env, projectId:string, limit=200) {
  const result=await env.DB.prepare("SELECT * FROM automatic_project_events WHERE project_id=? ORDER BY created_at DESC LIMIT ?").bind(projectId,Math.max(1,Math.min(limit,1000))).all<Record<string,unknown>>();
  return result.results||[];
}

export async function getProjectSlot(env:Env,projectId:string){
  const project=await getAutomaticProject(env,projectId);
  if(project && !projectIsClosed(project) && Number(project.total_items||0)===0 && (String(project.status||"")==="WAITING_FILES" || String(project.pipeline_status||"")==="AGUARDANDO")){
    const script=await env.DB.prepare("SELECT id FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' LIMIT 1").bind(projectId).first();
    if(script)await reconcileAutomaticProject(env,projectId).catch(()=>undefined);
  }
  return projectSlotSnapshot(env,projectId);
}
