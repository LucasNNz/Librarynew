import type { Env } from "../types";
import { createSignedProjectFileUrl, validSignedProjectFileRequest } from "./auth";
import { id, nowMs, stableId } from "./ids";
import { projectWriteGuard, updateProjectWorkflow } from "./project-workflow";

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


async function sha256Hex(bytes: Uint8Array) {
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function attachProjectScriptInline(request:Request,env:Env,input:{projectId:string;content:string;fileName?:string}){
  const projectId=clean(input.projectId);
  const guard=await projectWriteGuard(env,projectId);
  if(!guard.ok)return guard;
  const content=String(input.content??"");
  if(!content.trim())return {error:"SCRIPT_EMPTY",status:400} as const;
  const bytes=new TextEncoder().encode(content);
  const maxBytes=2*1024*1024;
  if(bytes.byteLength>maxBytes)return {error:"SCRIPT_TOO_LARGE",maxBytes,sizeBytes:bytes.byteLength,status:413} as const;
  const role="SCRIPT";
  const fileName=safeName(input.fileName||"SCRIPT.txt");
  const contentHash=await sha256Hex(bytes);
  const fileId=await stableId("PF",`${projectId}\n${role}\n${contentHash}`,12);
  const existing=await env.DB.prepare("SELECT id,project_id,role,version,file_name,r2_key,mime_type,size_bytes,content_hash,created_at FROM automatic_project_files WHERE id=?").bind(fileId).first<Record<string,unknown>>();
  if(existing){
    return {...existing,ok:true,idempotent:true,projectFileId:fileId,download_url:await createSignedProjectFileUrl(request,fileId,env,900)};
  }
  const r2Key=`projects/${projectId}/files/script/${fileId}-${fileName}`;
  await env.MEDIA.put(r2Key,bytes,{httpMetadata:{contentType:"text/plain; charset=utf-8"},customMetadata:{projectId,role,fileId,contentHash,inlineMcp:"true"}});
  const ts=nowMs();
  const insert=await env.DB.prepare(`INSERT OR IGNORE INTO automatic_project_files (id,project_id,role,version,file_name,r2_key,mime_type,size_bytes,content_hash,created_at)
    SELECT ?,?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,? FROM automatic_project_files WHERE project_id=? AND upper(role)=?`)
    .bind(fileId,projectId,role,fileName,r2Key,"text/plain; charset=utf-8",bytes.byteLength,contentHash,ts,projectId,role).run();
  const row=await env.DB.prepare("SELECT id,project_id,role,version,file_name,r2_key,mime_type,size_bytes,content_hash,created_at FROM automatic_project_files WHERE id=?").bind(fileId).first<Record<string,unknown>>();
  if(!row){
    await env.MEDIA.delete(r2Key).catch(()=>undefined);
    return {error:"SCRIPT_DB_INSERT_FAILED",status:500} as const;
  }
  const inserted=Number((insert as any)?.meta?.changes||0)>0;
  if(inserted){
    await env.DB.batch([
      env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SCRIPT_ATTACHED_INLINE","OK",JSON.stringify({fileId,role,fileName,sizeBytes:bytes.byteLength,contentHash,transport:"MCP_INLINE"}),ts),
      env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,updated_at=? WHERE id=?").bind(ts,projectId),
    ]);
    await updateProjectWorkflow(env,{projectId,activate:["READ"],metadata:{source:"SCRIPT_ATTACHED_INLINE"}}).catch(()=>undefined);
  }
  return {...row,ok:true,idempotent:!inserted,projectFileId:fileId,transport:"MCP_INLINE",download_url:await createSignedProjectFileUrl(request,fileId,env,900)};
}
