import type { Env } from "../types";
import { createSignedProjectFileUrl, validSignedProjectFileRequest } from "./auth";
import { id, nowMs } from "./ids";

function clean(value: unknown){return String(value??"").trim();}
function safeName(value:string){return value.replace(/[\\/:*?"<>|\x00-\x1f]+/g,"-").replace(/\s+/g," ").trim().slice(0,180)||"arquivo";}

export async function listProjectFiles(request:Request,env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=?").bind(projectId).first();
  if(!project)return null;
  const rows=await env.DB.prepare("SELECT id,project_id,role,version,file_name,mime_type,size_bytes,content_hash,created_at FROM automatic_project_files WHERE project_id=? ORDER BY role,version DESC,created_at DESC").bind(projectId).all<Record<string,unknown>>();
  return {projectId,files:await Promise.all((rows.results||[]).map(async row=>({...row,download_url:await createSignedProjectFileUrl(request,clean(row.id),env,900)})))};
}

export async function readProjectFile(env:Env,projectId:string,role:string,version?:number){
  const params:unknown[]=[projectId,role.toUpperCase()];
  let sql="SELECT * FROM automatic_project_files WHERE project_id=? AND upper(role)=?";
  if(version){sql+=" AND version=?";params.push(version);}sql+=" ORDER BY version DESC,created_at DESC LIMIT 1";
  const row=await env.DB.prepare(sql).bind(...params).first<Record<string,unknown>>();if(!row)return null;
  const object=await env.MEDIA.get(clean(row.r2_key));if(!object)return {...row,error:"R2_OBJECT_MISSING"};
  const mime=clean(row.mime_type).toLowerCase();if(!mime.startsWith("text/") && !mime.includes("json") && !mime.includes("xml"))return {...row,error:"BINARY_FILE_USE_DOWNLOAD"};
  const max=2*1024*1024;if(Number(row.size_bytes||0)>max)return {...row,error:"FILE_TOO_LARGE_FOR_INLINE_READ"};
  return {...row,content:await object.text()};
}

export async function getProjectFileLink(request:Request,env:Env,fileId:string,ttlMinutes=15){
  const row=await env.DB.prepare("SELECT id,project_id,role,version,file_name,mime_type,size_bytes FROM automatic_project_files WHERE id=?").bind(fileId).first<Record<string,unknown>>();if(!row)return null;
  const ttl=Math.max(1,Math.min(ttlMinutes,60))*60;
  return {...row,download_url:await createSignedProjectFileUrl(request,fileId,env,ttl),expires_at:new Date(Date.now()+ttl*1000).toISOString()};
}

export async function serveProjectFile(request:Request,fileId:string,env:Env){
  if(!(await validSignedProjectFileRequest(request,fileId,env)))return new Response("Forbidden",{status:403});
  const row=await env.DB.prepare("SELECT * FROM automatic_project_files WHERE id=?").bind(fileId).first<Record<string,unknown>>();if(!row)return new Response("Not found",{status:404});
  const object=await env.MEDIA.get(clean(row.r2_key));if(!object)return new Response("Not found",{status:404});
  return new Response(object.body,{headers:{"content-type":clean(row.mime_type)||"application/octet-stream","content-disposition":`attachment; filename=\"${safeName(clean(row.file_name))}\"`,"cache-control":"private, max-age=60"}});
}

export async function addProjectQaEvent(env:Env,projectId:string,input:{status:string;detail?:unknown;event?:string}){
  const project=await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=?").bind(projectId).first();if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const ts=nowMs(),eventId=id("PEV"),status=clean(input.status).toUpperCase()||"PASS";
  await env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(eventId,projectId,input.event||"PROJECT_QA",status,JSON.stringify(input.detail??{}),ts).run();
  return {ok:true,eventId,projectId,status};
}
