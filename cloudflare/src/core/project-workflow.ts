import type { Env } from "../types";
import { id, nowMs } from "./ids";

const clean=(v:unknown)=>String(v??"").trim();
const upper=(v:unknown)=>clean(v).toUpperCase();
const WORKING_TAGS=new Set(["REFERENCE_ANALYSIS_WORKING","COLLECTOR_WORKING","VISUAL_ANALYST_WORKING","DOWNLOADER_WORKING","THUMBS_WORKING","TITLES_WORKING"]);
const FALLBACK:Record<string,string>={
  REFERENCE_ANALYSIS_WORKING:"READ",
  COLLECTOR_WORKING:"REFERENCE_CHECKED",
  VISUAL_ANALYST_WORKING:"COLLECTOR_FINISHED",
  DOWNLOADER_WORKING:"VISUAL_ANALYST_FINISHED",
  THUMBS_WORKING:"READ",
  TITLES_WORKING:"READ",
};
export const PROJECT_WORKFLOW_TAGS=["READ","REFERENCE_ANALYSIS_WORKING","REFERENCE_CHECKED","COLLECTOR_WORKING","COLLECTOR_FINISHED","VISUAL_ANALYST_WORKING","VISUAL_ANALYST_FINISHED","DOWNLOADER_WORKING","DOWNLOADER_COMPLETED","THUMBS_WORKING","TITLES_WORKING"] as const;

export function projectIsClosed(project:Record<string,unknown>|null|undefined){
  if(!project)return false;
  const lifecycle=upper(project.lifecycle_status), status=upper(project.status);
  return Number(project.mcp_locked||0)===1 || ["COMPLETED","REJECTED"].includes(lifecycle) || ["COMPLETED","DONE","REJECTED","CANCELLED"].includes(status);
}

export async function projectWriteGuard(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return {ok:false,error:"PROJECT_NOT_FOUND",status:404} as const;
  if(projectIsClosed(project))return {ok:false,error:"PROJECT_LOCKED",lifecycleStatus:project.lifecycle_status||project.status,mcpLocked:true,explicitReopenRequired:true,status:409} as const;
  return {ok:true,project,status:200} as const;
}

async function ensureStableTag(env:Env,projectId:string,tag:string,ts:number){
  if(!tag)return;
  await env.DB.prepare(`INSERT INTO v2_project_workflow_tags(id,project_id,tag,status,metadata_json,created_at,updated_at)
    VALUES (?,?,?,'ACTIVE','{}',?,?) ON CONFLICT(project_id,tag) DO UPDATE SET status='ACTIVE',ended_at=NULL,updated_at=excluded.updated_at`)
    .bind(id("PWT"),projectId,tag,ts,ts).run();
}

export async function expireProjectWorkflowTags(env:Env,projectId?:string){
  const ts=nowMs(); const values:unknown[]=[ts]; let where="";
  if(projectId){where=" AND project_id=?";values.push(projectId);}
  const expired=await env.DB.prepare(`SELECT project_id,tag FROM v2_project_workflow_tags WHERE status='ACTIVE' AND lease_expires_at IS NOT NULL AND lease_expires_at<?${where}`)
    .bind(...values).all<Record<string,unknown>>();
  for(const row of expired.results||[]){
    const pid=clean(row.project_id), tag=upper(row.tag);
    await env.DB.prepare("UPDATE v2_project_workflow_tags SET status='EXPIRED',ended_at=?,updated_at=? WHERE project_id=? AND tag=? AND status='ACTIVE'").bind(ts,ts,pid,tag).run();
    const fallback=FALLBACK[tag]; if(fallback)await ensureStableTag(env,pid,fallback,ts);
    await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id("PEV"),pid,"WORKFLOW_HEARTBEAT_EXPIRED",fallback||"IDLE",JSON.stringify({tag,fallback}),ts).run().catch(()=>undefined);
    await env.DB.prepare("UPDATE automatic_projects SET workflow_updated_at=?,state_version=state_version+1,updated_at=? WHERE id=?").bind(ts,ts,pid).run();
  }
  return {expired:(expired.results||[]).length,checkedAt:ts};
}

export async function updateProjectWorkflow(env:Env,input:{projectId:string;activate?:string[];clear?:string[];ownerId?:string;executionId?:string;ttlSeconds?:number;metadata?:unknown}){
  const guard=await projectWriteGuard(env,input.projectId); if(!guard.ok)return guard;
  await expireProjectWorkflowTags(env,input.projectId);
  const ts=nowMs(), ttl=Math.max(30,Math.min(Number(input.ttlSeconds||300),7200));
  const allowed=new Set<string>(PROJECT_WORKFLOW_TAGS as readonly string[]);
  const requestedActivate=[...new Set((input.activate||[]).map(upper).filter(Boolean))];
  const requestedClear=[...new Set((input.clear||[]).map(upper).filter(Boolean))];
  const invalid=[...requestedActivate,...requestedClear].filter(tag=>!allowed.has(tag));
  if(invalid.length)return {ok:false,error:"INVALID_WORKFLOW_TAG",invalid:[...new Set(invalid)],allowed:[...allowed],status:400} as const;
  const activate=requestedActivate,clear=requestedClear;
  for(const tag of clear){
    await env.DB.prepare("UPDATE v2_project_workflow_tags SET status='CLEARED',ended_at=?,updated_at=? WHERE project_id=? AND tag=? AND status='ACTIVE'").bind(ts,ts,input.projectId,tag).run();
  }
  for(const tag of activate){
    const working=WORKING_TAGS.has(tag), expires=working?ts+ttl*1000:null;
    if(working){
      const held=await env.DB.prepare("SELECT owner_id,execution_id,lease_expires_at FROM v2_project_workflow_tags WHERE project_id=? AND tag=? AND status='ACTIVE' LIMIT 1").bind(input.projectId,tag).first<Record<string,unknown>>();
      const heldUntil=Number(held?.lease_expires_at||0),sameOwner=clean(held?.owner_id)===clean(input.ownerId);
      if(held&&heldUntil>ts&&!sameOwner)return {ok:false,error:"WORKFLOW_TAG_LEASED",tag,ownerId:held.owner_id,executionId:held.execution_id,leaseExpiresAt:heldUntil,status:409} as const;
    }
    await env.DB.prepare(`INSERT INTO v2_project_workflow_tags(id,project_id,tag,status,owner_id,execution_id,ttl_seconds,last_seen_at,lease_expires_at,metadata_json,created_at,updated_at,ended_at)
      VALUES (?,?,?,'ACTIVE',?,?,?,?,?,?,?, ?,NULL)
      ON CONFLICT(project_id,tag) DO UPDATE SET status='ACTIVE',owner_id=excluded.owner_id,execution_id=excluded.execution_id,ttl_seconds=excluded.ttl_seconds,last_seen_at=excluded.last_seen_at,lease_expires_at=excluded.lease_expires_at,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at,ended_at=NULL`)
      .bind(id("PWT"),input.projectId,tag,input.ownerId||null,input.executionId||null,working?ttl:null,working?ts:null,expires,JSON.stringify(input.metadata||{}),ts,ts).run();
  }
  await env.DB.prepare("UPDATE automatic_projects SET workflow_updated_at=?,state_version=state_version+1,updated_at=? WHERE id=?").bind(ts,ts,input.projectId).run();
  await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)")
    .bind(id("PEV"),input.projectId,"WORKFLOW_UPDATED","ACTIVE",JSON.stringify({activate,clear,ownerId:input.ownerId||null,executionId:input.executionId||null}),ts).run().catch(()=>undefined);
  return projectSlotSnapshot(env,input.projectId);
}

export async function heartbeatProjectWorkflow(env:Env,input:{projectId:string;tags:string[];ownerId:string;executionId:string;ttlSeconds?:number}){
  const guard=await projectWriteGuard(env,input.projectId); if(!guard.ok)return guard;
  const allowed=new Set<string>(PROJECT_WORKFLOW_TAGS as readonly string[]),normalized=[...new Set((input.tags||[]).map(upper).filter(Boolean))],invalid=normalized.filter(tag=>!allowed.has(tag));
  if(invalid.length)return {ok:false,error:"INVALID_WORKFLOW_TAG",invalid,allowed:[...allowed],status:400} as const;
  const ts=nowMs(),ttl=Math.max(30,Math.min(Number(input.ttlSeconds||300),7200)),expires=ts+ttl*1000; const results:Record<string,unknown>[]=[];
  for(const tag of normalized){const result=await env.DB.prepare(`UPDATE v2_project_workflow_tags SET last_seen_at=?,lease_expires_at=?,ttl_seconds=?,updated_at=? WHERE project_id=? AND tag=? AND status='ACTIVE' AND owner_id=? AND execution_id=?`)
    .bind(ts,expires,ttl,ts,input.projectId,tag,input.ownerId,input.executionId).run();results.push({tag,updated:Number(result.meta?.changes||0)>0});}
  return {ok:true,projectId:input.projectId,lastSeenAt:ts,leaseExpiresAt:expires,results};
}

export async function syncDerivedProjectWorkflow(env:Env,projectId:string){
  const guard=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>(); if(!guard||projectIsClosed(guard))return;
  const items=await env.DB.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN target_candidates>0 THEN 1 ELSE 0 END) collection_items,
    SUM(CASE WHEN target_candidates>0 AND collection_status='COMPLETE' THEN 1 ELSE 0 END) collection_complete,
    SUM(CASE WHEN target_candidates>0 AND qa_status='QA_COMPLETE' THEN 1 ELSE 0 END) qa_complete
    FROM automatic_project_items WHERE project_id=?`).bind(projectId).first<Record<string,unknown>>();
  const collectionItems=Number(items?.collection_items||0),collectionComplete=Number(items?.collection_complete||0),qaComplete=Number(items?.qa_complete||0),ts=nowMs();
  if(collectionItems>0&&collectionComplete>=collectionItems){
    await env.DB.prepare("UPDATE v2_project_workflow_tags SET status='CLEARED',ended_at=?,updated_at=? WHERE project_id=? AND tag='COLLECTOR_WORKING' AND status='ACTIVE'").bind(ts,ts,projectId).run();
    await ensureStableTag(env,projectId,"COLLECTOR_FINISHED",ts);
  }
  if(collectionItems>0&&qaComplete>=collectionItems){
    await env.DB.prepare("UPDATE v2_project_workflow_tags SET status='CLEARED',ended_at=?,updated_at=? WHERE project_id=? AND tag='VISUAL_ANALYST_WORKING' AND status='ACTIVE'").bind(ts,ts,projectId).run();
    await ensureStableTag(env,projectId,"VISUAL_ANALYST_FINISHED",ts);
  }
}

export async function projectSlotSnapshot(env:Env,projectId:string){
  await expireProjectWorkflowTags(env,projectId);
  await syncDerivedProjectWorkflow(env,projectId).catch(()=>undefined);
  const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>(); if(!project)return null;
  const [tags,script,referenceBrief,thumbs,titles,items,candidates,packages,slotAccess]=await Promise.all([
    env.DB.prepare("SELECT tag,status,owner_id,execution_id,last_seen_at,lease_expires_at,updated_at FROM v2_project_workflow_tags WHERE project_id=? AND status='ACTIVE' ORDER BY updated_at DESC").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,version,file_name,size_bytes,created_at FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,role,version,file_name,size_bytes,created_at FROM automatic_project_files WHERE project_id=? AND upper(role) IN ('REFERENCES','REFERENCIAS','REFERENCE_BRIEF','IMAGENS_NECESSARIAS','IMAGENS NECESSARIAS') ORDER BY created_at DESC,version DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN selected=1 THEN 1 ELSE 0 END) selected FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND status NOT IN ('THUMB_REJECTED','REJECTED')").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN selected=1 THEN 1 ELSE 0 END) selected FROM v2_project_titles WHERE project_id=? AND status NOT IN ('TITLE_REJECTED','REJECTED')").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) total,SUM(target_candidates) target,SUM(required_approved) required_approved,SUM(materialized_count) materialized,SUM(approved_count) approved,
      SUM(CASE WHEN target_candidates>0 AND collection_status='COMPLETE' THEN 1 ELSE 0 END) collection_complete,
      SUM(CASE WHEN target_candidates>0 THEN 1 ELSE 0 END) collection_items,
      SUM(CASE WHEN target_candidates>0 AND qa_status='QA_COMPLETE' THEN 1 ELSE 0 END) qa_complete,
      SUM(CASE WHEN linked_asset_id IS NOT NULL THEN 1 ELSE 0 END) library_linked FROM automatic_project_items WHERE project_id=?`).bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='DISCOVERED' THEN 1 ELSE 0 END) reserve,SUM(CASE WHEN status IN ('QUEUED','DOWNLOADING','RETRYING') THEN 1 ELSE 0 END) active,SUM(CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN 1 ELSE 0 END) materialized,SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) approved,SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed FROM v2_ingest_candidates WHERE project_id=?`).bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,status,file_name,size_bytes,ready_at,downloaded_at,created_at FROM v2_download_packages WHERE project_id=? ORDER BY created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT slot_key,mcp_open,instruction,opened_by,opened_at,updated_at FROM v2_project_slot_access WHERE project_id=?").bind(projectId).all<Record<string,unknown>>(),
  ]);
  const activeTags=(tags.results||[]).map(row=>({...row,tag:upper(row.tag)}));
  const target=Number(items?.target||0),materialized=Number(items?.materialized||0),required=Number(items?.required_approved||0),approved=Math.max(Number(items?.approved||0),Number(candidates?.approved||0));
  const accessMap=new Map((slotAccess.results||[]).map(row=>[String(row.slot_key),row]));
  const slot=(key:string,label:string,state:string,summary:string,progress:number)=>{const access=accessMap.get(key);const implicitReference=key==="reference"&&!access;return {key,label,state,summary,progress:Math.max(0,Math.min(100,Math.round(progress))),mcpOpen:implicitReference?true:Boolean(Number(access?.mcp_open||0)),instruction:access?.instruction||(implicitReference?"Agente de referências: grave aqui o TXT que orienta exatamente o que o Coletor precisa buscar.":null),openedBy:access?.opened_by||(implicitReference?"SYSTEM_DEFAULT":null),openedAt:access?.opened_at||null};};
  const scriptReady=Boolean(script),referenceReady=Boolean(referenceBrief),thumbCount=Number(thumbs?.total||0),titleCount=Number(titles?.total||0),zipStatus=upper(packages?.status || (project.zip_r2_key ? "READY" : "MISSING"));
  const slots=[
    slot("script","Roteiro",scriptReady?"READY":"MISSING",scriptReady?`SCRIPT v${Number(script?.version||1)}`:"Aguardando roteiro",scriptReady?100:0),
    slot("reference","Referências do Coletor",referenceReady?"READY":activeTags.some(t=>t.tag==="REFERENCE_ANALYSIS_WORKING")?"WORKING":"WAITING",referenceReady?`${String(referenceBrief?.file_name||"REFERENCIAS_COLETOR.txt")} · v${Number(referenceBrief?.version||1)}`:"Aguardando TXT do agente de referências",referenceReady?100:activeTags.some(t=>t.tag==="REFERENCE_ANALYSIS_WORKING")?50:0),
    slot("thumbs","Thumbs",thumbCount?"READY":"MISSING",`${Math.min(thumbCount,3)}/3 opções`,thumbCount/3*100),
    slot("titles","Títulos",titleCount?"READY":"MISSING",`${Math.min(titleCount,3)}/3 opções`,titleCount/3*100),
    slot("candidates","Coleta / candidatas",target>0&&materialized>=target?"READY":target>0?"WORKING":"WAITING",target?`${materialized}/${target} MATERIALIZED · ${Number(candidates?.reserve||0)} reserva`:"Sem cenas de coleta",target?materialized/target*100:0),
    slot("approved","Imagens aprovadas",required>0&&approved>=required?"READY":required>0?"WORKING":"WAITING",required?`${approved}/${required} necessárias`:`${approved} aprovadas`,required?approved/required*100:(approved?100:0)),
    slot("zip","ZIP final",["READY","READY_FOR_DOWNLOAD","DOWNLOADED","COMPLETED"].includes(zipStatus)?"READY":"WAITING",packages?.file_name?String(packages.file_name):"Ainda não gerado",packages?100:0),
  ];
  const progress=Math.round(slots.reduce((sum,s)=>sum+s.progress,0)/slots.length);
  return {project:{...project,mcp_locked:Number(project.mcp_locked||0),lifecycle_status:project.lifecycle_status||"ACTIVE"},activeTags,slots,progress,script,referenceBrief:referenceBrief||null,thumbs:{count:thumbCount,selected:Number(thumbs?.selected||0),max:3},titles:{count:titleCount,selected:Number(titles?.selected||0),max:3},items:{...items},candidates:{...candidates},package:packages||null,slotAccess:slotAccess.results||[]};
}

export async function setProjectLifecycle(env:Env,input:{projectIds:string[];action:"COMPLETE"|"REJECT"|"REOPEN";reason?:string}){
  const ids=[...new Set((input.projectIds||[]).map(clean).filter(Boolean))].slice(0,200),ts=nowMs(),results:Record<string,unknown>[]=[];
  for(const projectId of ids){
    const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>(); if(!project){results.push({projectId,error:"NOT_FOUND"});continue;}
    if(input.action==="REOPEN"){
      await env.DB.prepare("UPDATE automatic_projects SET lifecycle_status='ACTIVE',mcp_locked=0,status='ACTIVE',pipeline_status='AGUARDANDO',completed_at=NULL,rejected_at=NULL,closed_reason=NULL,resumed_at=?,resume_reason=?,state_version=state_version+1,updated_at=? WHERE id=?").bind(ts,input.reason||"EXPLICIT_REOPEN",ts,projectId).run();
      results.push({projectId,lifecycleStatus:"ACTIVE",mcpLocked:false}); continue;
    }
    const complete=input.action==="COMPLETE",lifecycle=complete?"COMPLETED":"REJECTED",status=complete?"COMPLETED":"REJECTED",pipeline=complete?"CONCLUIDO":"REJEITADO";
    await env.DB.batch([
      env.DB.prepare(`UPDATE automatic_projects SET lifecycle_status=?,mcp_locked=1,status=?,pipeline_status=?,next_action=NULL,completed_at=?,rejected_at=?,closed_reason=?,state_version=state_version+1,updated_at=? WHERE id=?`).bind(lifecycle,status,pipeline,complete?ts:null,complete?null:ts,input.reason||null,ts,projectId),
      env.DB.prepare("UPDATE worker_work_items SET status='CANCELLED',completed_at=?,updated_at=? WHERE project_id=? AND status IN ('READY','LEASED')").bind(ts,ts,projectId),
      env.DB.prepare("UPDATE v2_project_workflow_tags SET status='CLEARED',ended_at=?,updated_at=? WHERE project_id=? AND status='ACTIVE'").bind(ts,ts,projectId),
      env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,complete?"PROJECT_COMPLETED":"PROJECT_REJECTED",pipeline,input.reason||null,ts),
    ]);
    results.push({projectId,lifecycleStatus:lifecycle,mcpLocked:true});
  }
  return {ok:true,action:input.action,updated:results.filter(r=>!r.error).length,results};
}

export async function deleteProjectsPermanently(env:Env,projectIds:string[],confirm:boolean){
  if(!confirm)return {error:"CONFIRMATION_REQUIRED",status:400} as const;
  const ids=[...new Set(projectIds.map(clean).filter(Boolean))].slice(0,100),results:Record<string,unknown>[]=[];
  for(const projectId of ids){
    const project=await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=?").bind(projectId).first(); if(!project){results.push({projectId,error:"NOT_FOUND"});continue;}
    const objects:string[]=[];
    for(const sql of ["SELECT r2_key FROM automatic_project_files WHERE project_id=?","SELECT r2_key FROM v2_project_media WHERE project_id=?","SELECT r2_key FROM v2_download_packages WHERE project_id=?","SELECT r2_key FROM v2_ingest_candidates WHERE project_id=? AND r2_key LIKE 'incoming/%'"]){const rows=await env.DB.prepare(sql).bind(projectId).all<{r2_key?:string}>();for(const row of rows.results||[])if(row.r2_key)objects.push(row.r2_key);}
    for(let offset=0;offset<objects.length;offset+=1000)await env.MEDIA.delete(objects.slice(offset,offset+1000)).catch(()=>undefined);
    const tables=["v2_project_slot_access","v2_project_workflow_tags","v2_runtime_heartbeats","worker_events","worker_work_items","worker_sessions","supervisor_project_candidates","supervisor_decision_queue","plan_branches","source_routing_plans","v2_control_jobs","v2_download_packages","v2_project_media","v2_project_titles","v2_ingest_events","v2_ingest_candidates","automatic_project_events","automatic_project_files","automatic_project_items"];
    for(const table of tables){
      try { if(table==="v2_runtime_heartbeats") await env.DB.prepare("DELETE FROM v2_runtime_heartbeats WHERE scope_id LIKE ?").bind(`%${projectId}%`).run(); else await env.DB.prepare(`DELETE FROM ${table} WHERE project_id=?`).bind(projectId).run(); } catch{}
    }
    await env.DB.prepare("DELETE FROM automatic_projects WHERE id=?").bind(projectId).run();
    results.push({projectId,deleted:true,r2ObjectsDeleted:objects.length});
  }
  return {ok:true,deleted:results.filter(r=>r.deleted).length,results};
}
