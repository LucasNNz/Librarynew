import type { Env } from "../types";
import { createSignedProjectMediaUrl } from "./auth";
import { id, nowMs } from "./ids";

const PROFILE_KIND="PROJECT_PROFILE";
const clean=(value:unknown)=>String(value??"").trim();

function metadata(value:unknown){
  try{return JSON.parse(String(value||"{}")) as Record<string,unknown>;}catch{return {} as Record<string,unknown>;}
}

async function ensureProject(env:Env,projectId:string){
  return env.DB.prepare("SELECT id,name FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
}

async function currentRow(env:Env,projectId:string){
  return env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? AND kind=? AND selected=1 AND status='PROFILE_ACTIVE' ORDER BY updated_at DESC LIMIT 1").bind(projectId,PROFILE_KIND).first<Record<string,unknown>>();
}

async function replaceProfile(env:Env,input:{projectId:string;r2Key:string;mimeType:string;sizeBytes:number;sourceUrl?:string|null;agentOrigin?:string;name?:string;sourceType:string;sourceId?:string|null}){
  const project=await ensureProject(env,input.projectId);if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  if(!clean(input.r2Key))return {error:"R2_KEY_REQUIRED",status:400} as const;
  const current=await currentRow(env,input.projectId);
  const currentMeta=metadata(current?.metadata_json);
  if(current && clean(current.r2_key)===clean(input.r2Key) && clean(currentMeta.sourceType)===input.sourceType && clean(currentMeta.sourceId)===clean(input.sourceId)){
    return {ok:true,idempotent:true,projectId:input.projectId,mediaId:current.id,sourceType:input.sourceType,status:"PROFILE_ACTIVE"} as const;
  }
  const ts=nowMs();const mediaId=id("PMEDIA");
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_project_media SET selected=0,status='PROFILE_REPLACED',updated_at=? WHERE project_id=? AND kind=? AND selected=1").bind(ts,input.projectId,PROFILE_KIND),
    env.DB.prepare("INSERT INTO v2_project_media (id,project_id,kind,status,name,r2_key,mime_type,size_bytes,source_url,agent_origin,selected,metadata_json,slot_index,orientation,created_at,updated_at) VALUES (?,?,?,'PROFILE_ACTIVE',?,?,?,?,?,?,1,?,NULL,NULL,?,?)")
      .bind(mediaId,input.projectId,PROFILE_KIND,input.name||`project-profile-${input.projectId}`,input.r2Key,input.mimeType||"image/jpeg",Math.max(0,Number(input.sizeBytes||0)),input.sourceUrl||null,input.agentOrigin||"PROJECT_PROFILE",JSON.stringify({sourceType:input.sourceType,sourceId:input.sourceId||null}),ts,ts),
    env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId),
    env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id("PEV"),input.projectId,"PROJECT_PROFILE_CHANGED","OK",JSON.stringify({mediaId,sourceType:input.sourceType,sourceId:input.sourceId||null,previousMediaId:current?.id||null}),ts),
  ]);
  return {ok:true,idempotent:false,projectId:input.projectId,mediaId,sourceType:input.sourceType,status:"PROFILE_ACTIVE"} as const;
}

export async function setProjectProfileFromCandidate(env:Env,input:{projectId:string;candidateId:string;origin?:string}){
  const candidate=await env.DB.prepare("SELECT id,project_id,status,r2_key,mime_type,size_bytes,source_url FROM v2_ingest_candidates WHERE id=?").bind(input.candidateId).first<Record<string,unknown>>();
  if(!candidate)return {error:"CANDIDATE_NOT_FOUND",status:404} as const;
  if(!["MATERIALIZED","APPROVED"].includes(clean(candidate.status).toUpperCase()))return {error:"CANDIDATE_NOT_MATERIALIZED",candidateStatus:candidate.status,status:409} as const;
  const candidateProject=clean(candidate.project_id);if(candidateProject&&candidateProject!==input.projectId)return {error:"CANDIDATE_ALREADY_LINKED_OTHER_PROJECT",candidateProjectId:candidateProject,status:409} as const;
  if(!candidateProject)await env.DB.prepare("UPDATE v2_ingest_candidates SET project_id=?,updated_at=? WHERE id=?").bind(input.projectId,nowMs(),input.candidateId).run();
  return replaceProfile(env,{projectId:input.projectId,r2Key:clean(candidate.r2_key),mimeType:clean(candidate.mime_type)||"image/jpeg",sizeBytes:Number(candidate.size_bytes||0),sourceUrl:clean(candidate.source_url)||null,agentOrigin:input.origin||"PROJECT_PROFILE_CANDIDATE",name:`profile-${input.candidateId}`,sourceType:"CANDIDATE",sourceId:input.candidateId});
}

export async function setProjectProfileFromAsset(env:Env,input:{projectId:string;assetId:string;origin?:string}){
  const asset=await env.DB.prepare("SELECT id,name,status,r2_key,mime_type,size_bytes,source_url FROM assets WHERE id=?").bind(input.assetId).first<Record<string,unknown>>();
  if(!asset)return {error:"ASSET_NOT_FOUND",status:404} as const;
  if(!["APROVADO","APPROVED"].includes(clean(asset.status).toUpperCase()))return {error:"ASSET_NOT_APPROVED",assetStatus:asset.status,status:409} as const;
  return replaceProfile(env,{projectId:input.projectId,r2Key:clean(asset.r2_key),mimeType:clean(asset.mime_type)||"image/jpeg",sizeBytes:Number(asset.size_bytes||0),sourceUrl:clean(asset.source_url)||null,agentOrigin:input.origin||"PROJECT_PROFILE_LIBRARY",name:clean(asset.name)||`profile-${input.assetId}`,sourceType:"ASSET",sourceId:input.assetId});
}

export async function clearProjectProfile(env:Env,projectId:string,origin="UI"){
  const project=await ensureProject(env,projectId);if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const current=await currentRow(env,projectId);if(!current)return {ok:true,idempotent:true,projectId,cleared:false} as const;
  const ts=nowMs();await env.DB.batch([
    env.DB.prepare("UPDATE v2_project_media SET selected=0,status='PROFILE_REPLACED',updated_at=? WHERE id=?").bind(ts,current.id),
    env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,projectId),
    env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"PROJECT_PROFILE_CLEARED","OK",JSON.stringify({mediaId:current.id,origin}),ts),
  ]);return {ok:true,projectId,cleared:true,previousMediaId:current.id} as const;
}

export async function getProjectProfile(request:Request,env:Env,projectId:string){
  const project=await ensureProject(env,projectId);if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const row=await currentRow(env,projectId);if(!row)return {ok:true,projectId,profile:null} as const;
  const meta=metadata(row.metadata_json);
  return {ok:true,projectId,profile:{media_id:row.id,name:row.name,mime_type:row.mime_type,size_bytes:Number(row.size_bytes||0),source_type:meta.sourceType||"UNKNOWN",source_id:meta.sourceId||null,updated_at:row.updated_at,preview_url:await createSignedProjectMediaUrl(request,clean(row.id),env,1800)}} as const;
}
