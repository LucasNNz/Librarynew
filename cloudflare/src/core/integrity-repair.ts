import type { Env } from "../types";
import { id, nowMs } from "./ids";
import { parseProjectScriptScenes } from "./project-script-parser";
import { reconcileAutomaticProject } from "./projects";
import { productionModelCounts } from "./production-model";

const terminalItemStates = new Set(["APROVADO","APPROVED","CONCLUIDO","CONCLUÍDO","FROZEN","CONGELADO","ASSIGNED_FOR_QA","RETIRED","FAILED","FALHOU","CANCELADO","CANCELLED"]);
const upper=(v:unknown)=>String(v||"").trim().toUpperCase();
const clean=(v:unknown)=>String(v||"").trim();

function desiredWork(statusValue:unknown){
  const status=upper(statusValue);
  if(["MATERIALIZANDO","MATERIALIZING","MATERIALIZATION"].includes(status))return{stage:"MATERIALIZATION",workerType:"MATERIALIZATION"};
  if(["AGUARDANDO_QA","PARA_ANALISE","QA","WAITING_QA","ASSIGNED_FOR_QA"].includes(status))return{stage:"QA",workerType:"QA"};
  if(["RELINK","RELINK_REQUIRED","RELINKAR"].includes(status))return{stage:"RELINK",workerType:"RELINK"};
  if(["TECNICO","TECHNICAL","TECHNICAL_QA"].includes(status))return{stage:"TECHNICAL",workerType:"TECHNICAL"};
  return{stage:"DISCOVERY",workerType:"DISCOVERY"};
}

function workerRank(row:Record<string,unknown>,now:number){
  const status=upper(row.status),lease=Number(row.lease_expires_at||0);
  if(status==="LEASED"&&lease>now)return 100;
  if(status==="READY")return 90;
  if(status==="COMPLETED")return 80;
  if(status==="FAILED")return 50;
  if(status==="CANCELLED"||status==="SUPERSEDED")return 40;
  return 30;
}

export async function listWorkerUniqueConflicts(env:Env,input:{projectId?:string}={}){
  const bind:unknown[]=[]; const where:string[]=["scope_type IS NOT NULL","scope_id IS NOT NULL","stage IS NOT NULL"];
  if(input.projectId){where.push("project_id=?");bind.push(input.projectId);}
  const rows=await env.DB.prepare(`SELECT id AS work_item_id,scope_type,scope_id,project_id,item_id,stage,worker_type,status,priority,resume_priority,created_at,updated_at,completed_at,lease_owner_worker_id,lease_execution_id,lease_expires_at,last_action FROM worker_work_items WHERE ${where.join(" AND ")} ORDER BY scope_type,scope_id,stage,created_at,id`).bind(...bind).all<Record<string,unknown>>();
  const all=rows.results||[],now=nowMs(); const groups=new Map<string,Record<string,unknown>[]>();
  for(const row of all){const key=`${clean(row.scope_type)}\u0000${clean(row.scope_id)}\u0000${clean(row.stage)}`;const list=groups.get(key)||[];list.push(row);groups.set(key,list);}
  const conflicts:any[]=[];
  for(const [key,list] of groups){if(list.length<2)continue;const ordered=[...list].sort((a,b)=>workerRank(b,now)-workerRank(a,now)||Number(a.created_at||0)-Number(b.created_at||0));const preserve=ordered[0];conflicts.push({type:"PHYSICAL_UNIQUE_DUPLICATE",unique_key:key.split("\u0000"),preserve_work_item_id:preserve.work_item_id,duplicates:ordered.slice(1).map(row=>row.work_item_id),records:ordered});}

  // A strict UNIQUE key can also be blocked by one historical row. Detect that before reconcile tries INSERT.
  const itemWhere=["upper(COALESCE(status,'')) NOT IN ('APROVADO','APPROVED','CONCLUIDO','CONCLUÍDO','FROZEN','CONGELADO','ASSIGNED_FOR_QA','RETIRED','FAILED','FALHOU','CANCELADO','CANCELLED')"];
  const itemBind:unknown[]=[]; if(input.projectId){itemWhere.push("project_id=?");itemBind.push(input.projectId);}
  const items=await env.DB.prepare(`SELECT id,project_id,status,target_file,priority FROM automatic_project_items WHERE ${itemWhere.join(" AND ")} ORDER BY project_id,created_at`).bind(...itemBind).all<Record<string,unknown>>();
  const byKey=new Map<string,Record<string,unknown>[]>();for(const row of all){const k=`${clean(row.scope_type)}\u0000${clean(row.scope_id)}\u0000${clean(row.stage)}`;byKey.set(k,[...(byKey.get(k)||[]),row]);}
  for(const item of items.results||[]){if(terminalItemStates.has(upper(item.status)))continue;const desired=desiredWork(item.status);
    // Any active row for the same parent item/stage (including PROJECT_ITEM_REVISION) already satisfies the work requirement.
    const activeForItem=all.find(row=>clean(row.item_id)===clean(item.id)&&clean(row.stage)===desired.stage&&["READY","LEASED"].includes(upper(row.status)));if(activeForItem)continue;
    const key=`PROJECT_ITEM\u0000${clean(item.id)}\u0000${desired.stage}`;const exact=byKey.get(key)||[];if(!exact.length)continue;const blocker=[...exact].sort((a,b)=>workerRank(b,now)-workerRank(a,now))[0];const status=upper(blocker.status);conflicts.push({type:"HISTORICAL_UNIQUE_BLOCKER",unique_key:["PROJECT_ITEM",clean(item.id),desired.stage],project_id:item.project_id,item_id:item.id,item_status:item.status,target_file:item.target_file,work_item_id:blocker.work_item_id,status,action:status==="COMPLETED"?"PRESERVE_COMPLETED_AND_USE_REVISION_SCOPE":(["CANCELLED","FAILED","SUPERSEDED"].includes(status)?"REACTIVATE_EXISTING_ROW":"REVIEW"),record:blocker});}
  return{ok:true,project_id:input.projectId||null,found:conflicts.length,conflicts,unique_contract:"scope_type + scope_id + stage",read_only:true};
}

export async function deduplicateWorkerUnique(env:Env,input:{projectId?:string}={}){
  const before=await listWorkerUniqueConflicts(env,input);const ts=nowMs();const statements:D1PreparedStatement[]=[];let superseded=0,reactivated=0,preserved=0;
  for(const conflict of before.conflicts as any[]){
    if(conflict.type==="PHYSICAL_UNIQUE_DUPLICATE"){
      preserved++;
      for(const row of (conflict.records||[]).slice(1)){
        const wid=clean(row.work_item_id);if(!wid)continue;
        const status=upper(row.status);if(status==="COMPLETED"){preserved++;continue;}
        // Move duplicate history out of the strict unique tuple without deleting the row.
        statements.push(env.DB.prepare(`UPDATE worker_work_items SET scope_id=scope_id||'#SUPERSEDED#'||id,status='CANCELLED',last_action='UNIQUE_DEDUP_SUPERSEDED',completed_at=COALESCE(completed_at,?),lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`).bind(ts,ts,wid));superseded++;
      }
    } else if(conflict.type==="HISTORICAL_UNIQUE_BLOCKER"){
      const status=upper(conflict.status),wid=clean(conflict.work_item_id);
      if(["CANCELLED","FAILED","SUPERSEDED"].includes(status)&&wid){
        statements.push(env.DB.prepare(`UPDATE worker_work_items SET status='READY',ready_at=?,completed_at=NULL,last_action='UNIQUE_BLOCKER_REACTIVATED',lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('CANCELLED','FAILED','SUPERSEDED')`).bind(ts,ts,wid));reactivated++;
      } else preserved++;
    }
  }
  if(statements.length)await env.DB.batch(statements);
  const after=await listWorkerUniqueConflicts(env,input);
  return{ok:true,project_id:input.projectId||null,found:before.found,preserved,cancelled:superseded,superseded,reactivated,conflicts_remaining:after.found,remaining:after.conflicts,atomic_d1:true,idempotent:true,deleted:0};
}

export async function repairProjectWorkerItems(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT id,status,lifecycle_status FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)return{error:"PROJECT_NOT_FOUND",status:404} as const;
  const ts=nowMs();const dedupe=await deduplicateWorkerUnique(env,{projectId});
  const [orphan,terminal,expired]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare(`UPDATE worker_work_items SET status='CANCELLED',last_action='PROJECT_REPAIR_ORPHAN',completed_at=COALESCE(completed_at,?),updated_at=? WHERE project_id=? AND status='READY' AND item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM automatic_project_items i WHERE i.id=worker_work_items.item_id)`).bind(ts,ts,projectId),
    env.DB.prepare(`UPDATE worker_work_items SET status='CANCELLED',last_action='PROJECT_REPAIR_TERMINAL_PARENT',completed_at=COALESCE(completed_at,?),updated_at=? WHERE project_id=? AND status='READY' AND item_id IS NOT NULL AND EXISTS(SELECT 1 FROM automatic_project_items i WHERE i.id=worker_work_items.item_id AND upper(COALESCE(i.status,'')) IN ('APROVADO','APPROVED','CONCLUIDO','CONCLUÍDO','COMPLETED','FROZEN','CONGELADO','ASSIGNED_FOR_QA','RETIRED','CANCELADO','CANCELLED'))`).bind(ts,ts,projectId),
    env.DB.prepare(`UPDATE worker_work_items SET status='READY',resume_priority=resume_priority+1,last_action='PROJECT_REPAIR_EXPIRED_LEASE',lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,ready_at=?,updated_at=? WHERE project_id=? AND status='LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at<?`).bind(ts,ts,projectId,ts),
  ]);
  const reconcile=await reconcileAutomaticProject(env,projectId);
  const after=await listWorkerUniqueConflicts(env,{projectId});
  return{ok:true,project_id:projectId,dedupe,stale_cleanup:{orphan_cancelled:Number(orphan.meta?.changes||0),terminal_cancelled:Number(terminal.meta?.changes||0),expired_leases_requeued:Number(expired.meta?.changes||0)},reconcile,conflicts_remaining:after.found,conflicts:after.conflicts};
}

async function currentScriptShape(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT id,active_version,state_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)return{error:"PROJECT_NOT_FOUND",status:404} as const;
  const script=await env.DB.prepare("SELECT id,version,file_name,r2_key,size_bytes,mime_type,created_at FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>();if(!script?.r2_key)return{error:"SCRIPT_NOT_FOUND",status:404,project_id:projectId} as const;
  const obj=await env.MEDIA.get(clean(script.r2_key));if(!obj)return{error:"SCRIPT_R2_MISSING",status:404,project_id:projectId,r2_key:script.r2_key} as const;
  const content=await obj.text();const scenes=parseProjectScriptScenes(content);const targets=[...new Set(scenes.flatMap(scene=>scene.targetFiles.map(v=>clean(v).toLowerCase()).filter(Boolean)))];
  return{project,script,scenes,targets:new Set(targets),target_list:targets,active_version:Number(project.active_version||1),current_script_version:Number(script.version||1)};
}

export async function listObsoleteProductionSlots(env:Env,projectId:string){
  const shape=await currentScriptShape(env,projectId);if((shape as any).error)return shape as any;const s=shape as any;
  const rows=await env.DB.prepare(`SELECT id AS slot_id,version AS production_version,scene_id,slot_key,target_file,status,asset_id,candidate_id,created_at,updated_at,observation FROM v2_production_slots WHERE project_id=? AND version=? AND status<>'RETIRED' ORDER BY created_at,id`).bind(projectId,s.active_version).all<Record<string,unknown>>();
  const obsolete=(rows.results||[]).filter(row=>{const target=clean(row.target_file).toLowerCase();return target&&!s.targets.has(target);}).map(row=>({...row,script_version_created:null,current_script_version:s.current_script_version,reason:"NOT_PRESENT_IN_CURRENT_SCRIPT",script_version_created_note:"Legacy PSLOTs did not persist the exact SCRIPT file version at creation; production_version is returned separately."}));
  return{ok:true,project_id:projectId,production_version:s.active_version,current_script_version:s.current_script_version,script_file_id:s.script.id,script_file_name:s.script.file_name,expected_targets:s.target_list.length,active_slots:(rows.results||[]).length,obsolete_count:obsolete.length,items:obsolete,read_only:true};
}

export async function retireObsoleteProductionSlots(env:Env,input:{projectId:string;dryRun?:boolean}){
  const preview=await listObsoleteProductionSlots(env,input.projectId);if((preview as any).error)return preview as any;const dryRun=input.dryRun!==false;if(dryRun)return{...preview,dry_run:true,mutation_applied:false};
  const items=(preview as any).items as Record<string,unknown>[];if(!items.length)return{...preview,dry_run:false,mutation_applied:false,retired:0,idempotent:true};
  const ts=nowMs(),version=Number((preview as any).production_version||1),ids=items.map(row=>clean(row.slot_id)).filter(Boolean),targets=[...new Set(items.map(row=>clean(row.target_file).toLowerCase()).filter(Boolean))];
  const statements:D1PreparedStatement[]=[];const idMarks=ids.map(()=>"?").join(","),targetMarks=targets.map(()=>"?").join(",");
  statements.push(env.DB.prepare(`UPDATE v2_production_slots SET status='RETIRED',assigned_for_qa_at=NULL,qa_finalized_at=NULL,qa_operation_id=NULL,relink_required_at=NULL,relink_reason=NULL,rejected_by=NULL,rejected_operation_id=NULL,observation=CASE WHEN COALESCE(observation,'')='' THEN 'Retirado por aposentar_production_slots_obsoletos: não existe no SCRIPT atual.' ELSE observation||char(10)||'Retirado por aposentar_production_slots_obsoletos: não existe no SCRIPT atual.' END,updated_at=? WHERE project_id=? AND version=? AND id IN (${idMarks}) AND status<>'RETIRED'`).bind(ts,input.projectId,version,...ids));
  if(targets.length){
    statements.push(env.DB.prepare(`UPDATE automatic_project_items SET status='RETIRED',stage='DONE',collection_status='COMPLETE',qa_status='RETIRED',updated_at=? WHERE project_id=? AND version=? AND lower(trim(COALESCE(target_file,''))) IN (${targetMarks})`).bind(ts,input.projectId,version,...targets));
    statements.push(env.DB.prepare(`UPDATE worker_work_items SET status='CANCELLED',last_action='PSLOT_OBSOLETE_RETIRED',completed_at=COALESCE(completed_at,?),lease_owner_worker_id=NULL,lease_execution_id=NULL,lease_started_at=NULL,lease_last_seen_at=NULL,lease_expires_at=NULL,updated_at=? WHERE project_id=? AND item_id IN (SELECT id FROM automatic_project_items WHERE project_id=? AND version=? AND lower(trim(COALESCE(target_file,''))) IN (${targetMarks})) AND status IN ('READY','LEASED')`).bind(ts,ts,input.projectId,input.projectId,version,...targets));
  }
  for(const row of items)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,new_asset_id,previous_candidate_id,new_candidate_id,reason,operation_id,actor,created_at) VALUES (?,?,?,?,?,'PRODUCTION_SLOT_RETIRED',?,NULL,?,NULL,'NOT_PRESENT_IN_CURRENT_SCRIPT',NULL,'MCP_INTEGRITY_REPAIR',?)`).bind(id("PSH"),input.projectId,version,row.slot_id,row.target_file||null,row.asset_id||null,row.candidate_id||null,ts));
  statements.push(env.DB.prepare("UPDATE automatic_projects SET production_reconciled_at=NULL,state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId));
  statements.push(env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),input.projectId,"OBSOLETE_PRODUCTION_SLOTS_RETIRED","OK",JSON.stringify({retired:ids.length,target_files:targets,reason:"NOT_PRESENT_IN_CURRENT_SCRIPT"}),ts));
  await env.DB.batch(statements);
  const counts=await productionModelCounts(env,input.projectId);return{ok:true,project_id:input.projectId,dry_run:false,mutation_applied:true,retired:ids.length,target_files:targets,history_preserved:true,r2_untouched:true,atomic_d1:true,idempotent:true,counts};
}

export async function repairProjectIntegrity(env:Env,input:{projectId:string;dryRun?:boolean;confirm?:boolean;operationId?:string}){
  const dryRun=input.dryRun!==false;const [obsolete,workerConflicts,counts]=await Promise.all([listObsoleteProductionSlots(env,input.projectId),listWorkerUniqueConflicts(env,{projectId:input.projectId}),productionModelCounts(env,input.projectId).catch(()=>null)]);
  const plan={obsolete_slots:Number((obsolete as any).obsolete_count||0),worker_unique_conflicts:Number((workerConflicts as any).found||0),actions:["RETIRE_OBSOLETE_PSLOTS","RECONCILE_PITEMS","DEDUP_OR_REUSE_WORK_ITEMS","CREATE_ONLY_MISSING_WORK","RECALCULATE_COUNTS"]};
  if(dryRun)return{ok:true,project_id:input.projectId,dry_run:true,mutation_applied:false,plan,obsolete_slots:obsolete,worker_conflicts:workerConflicts,counts};
  if(!input.confirm)return{error:"CONFIRMATION_REQUIRED",status:409,project_id:input.projectId,dry_run:false,required:"confirmar=true"} as const;
  const operationId=clean(input.operationId)||`INTEGRITY-${input.projectId}-${nowMs()}`;
  const existing=await env.DB.prepare("SELECT status,result_json FROM v2_control_jobs WHERE operation_id=? AND kind='PROJECT_INTEGRITY_REPAIR' LIMIT 1").bind(operationId).first<Record<string,unknown>>().catch(()=>null);
  if(existing&&upper(existing.status)==="COMPLETED"){try{return{...JSON.parse(clean(existing.result_json)||"{}"),idempotent_replay:true,operation_id:operationId};}catch{return{ok:true,idempotent_replay:true,operation_id:operationId,status:"COMPLETED"};}}
  const retired=await retireObsoleteProductionSlots(env,{projectId:input.projectId,dryRun:false});
  const workers=await repairProjectWorkerItems(env,input.projectId);
  const finalCounts=await productionModelCounts(env,input.projectId).catch(()=>null);const result={ok:true,project_id:input.projectId,dry_run:false,mutation_applied:true,operation_id:operationId,retired,workers,counts:finalCounts};const ts=nowMs();
  await env.DB.prepare(`INSERT OR IGNORE INTO v2_control_jobs(id,operation_id,kind,project_id,status,payload_json,result_json,attempts,created_at,updated_at,completed_at) VALUES (?,?, 'PROJECT_INTEGRITY_REPAIR',?,'COMPLETED',?,?,1,?,?,?)`).bind(id("JOB"),operationId,input.projectId,JSON.stringify({project_id:input.projectId}),JSON.stringify(result),ts,ts,ts).run().catch(()=>undefined);
  return result;
}
