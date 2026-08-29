import type { Env } from "../types";
import { id, nowMs } from "./ids";

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
  const result=await env.DB.prepare(`SELECT id,name,status,pipeline_status,next_action,project_domain,queue_priority,state_version,total_items,approved_count,pending_count,failed_count,created_at,updated_at,completed_at FROM automatic_projects${where} ORDER BY updated_at DESC,id DESC LIMIT ?`).bind(...values,safe+1).all<Record<string,unknown>>();
  const rows=result.results||[]; const hasMore=rows.length>safe; const items=rows.slice(0,safe); const last=items[items.length-1];
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
  const [files,items,events]=await env.DB.batch([
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
  return {
    project_id:projectId,state_version:version,changed:true,status:project.status,pipeline_status:project.pipeline_status,next_action:project.next_action,
    counts:{ total:Number(project.total_items||0),approved:Number(project.approved_count||0),pending:Number(project.pending_count||0),failed:Number(project.failed_count||0),collecting:Number(project.collecting_count||0),materializing:Number(project.materializing_count||0),waiting_qa:Number(project.waiting_qa_count||0),relink:Number(project.relink_count||0),technical:Number(project.technical_count||0),frozen:Number(project.frozen_count||0) },
    lease:{status:project.supervisor_status,execution_id:project.supervisor_execution_id,expires_at:project.supervisor_lease_expires_at,last_seen_at:project.supervisor_last_seen_at},
    updated_at:project.updated_at,
  };
}
