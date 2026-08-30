import type { Env } from "../types";
import { createSignedUploadUrl, validSignedUploadRequest } from "./auth";
import { id, nowMs } from "./ids";
import { recordIngestEvent } from "./materialization";
import { refreshProjectItemPipelineState } from "./project-pipeline-state";
import { refreshRecoveryAfterWrite, writeCandidateRecoveryRecord, writeImportRecoveryRecord } from "./recovery-manifest";
import { materializeScenesFromProjectScript } from "./project-script-parser";
import { reconcileAutomaticProject } from "./projects";

function sanitizeFilename(value: string) {
  const clean=value.trim().replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
  return clean || `upload-${Date.now()}.bin`;
}
function normalizeTags(tags: unknown) { return Array.isArray(tags)?[...new Set(tags.map(String).map(v=>v.trim()).filter(Boolean))].slice(0,40):[]; }

export async function prepareDirectUpload(request:Request,env:Env,input:{fileName:string;mimeType?:string;maxBytes?:number;uploadType?:"CANDIDATE"|"PROJECT_FILE"|"IMPORT_ZIP";projectId?:string;itemId?:string;universe?:string;subject?:string;role?:string;tags?:string[];ttlSeconds?:number}) {
  const uploadId=id("UP"); const ts=nowMs(); const ttl=Math.max(60,Math.min(input.ttlSeconds||900,3600)); const expires=ts+ttl*1000;
  const fileName=sanitizeFilename(input.fileName); const maxBytes=Math.max(1024,Math.min(input.maxBytes||30*1024*1024,100*1024*1024));
  const uploadType=input.uploadType||"CANDIDATE"; const r2Key=`incoming/direct/${uploadId}/${fileName}`;
  await env.DB.prepare(`INSERT INTO v2_direct_uploads (id,upload_type,status,project_id,item_id,universe,subject,role,tags_json,file_name,r2_key,expected_mime,max_bytes,expires_at,created_at,updated_at) VALUES (?,?,'PREPARED',?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(uploadId,uploadType,input.projectId||null,input.itemId||null,input.universe||"",input.subject||"",input.role||null,JSON.stringify(normalizeTags(input.tags)),fileName,r2Key,input.mimeType||null,maxBytes,expires,ts,ts).run();
  return {uploadId,uploadType,status:"PREPARED",uploadUrl:await createSignedUploadUrl(request,uploadId,env,ttl),expiresAt:new Date(expires).toISOString(),maxBytes,r2Key};
}

export async function receiveDirectUpload(request:Request,uploadId:string,env:Env) {
  if(!(await validSignedUploadRequest(request,uploadId,env))) return new Response("Forbidden",{status:403});
  const ts=nowMs();
  let row=await env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();
  if(!row)return new Response("Not found",{status:404});
  if(String(row.status)==="UPLOADING"&&Number(row.updated_at||0)<ts-5*60_000){
    await env.DB.prepare("UPDATE v2_direct_uploads SET status='PREPARED',failure_reason='STALE_UPLOAD_RECOVERED',updated_at=? WHERE id=? AND status='UPLOADING' AND updated_at<?").bind(ts,uploadId,ts-5*60_000).run();
    row=await env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();
  }
  if(!row)return new Response("Not found",{status:404});
  if(String(row.status)!=="PREPARED")return new Response("Invalid state",{status:409});
  if(Number(row.expires_at)<ts)return new Response("Expired",{status:410});
  if(!request.body)return new Response("Body required",{status:400});
  const maxBytes=Number(row.max_bytes||30*1024*1024); const length=Number(request.headers.get("content-length")||0); if(length>maxBytes)return new Response("Too large",{status:413});
  const actualMime=(request.headers.get("content-type")||String(row.expected_mime||"application/octet-stream")).split(";")[0].trim().toLowerCase();
  const expected=String(row.expected_mime||"").toLowerCase(); if(expected && expected!==actualMime)return new Response("MIME mismatch",{status:415});
  const claimed=await env.DB.prepare("UPDATE v2_direct_uploads SET status='UPLOADING',upload_attempts=upload_attempts+1,last_attempt_at=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='PREPARED' AND expires_at>=? RETURNING *").bind(ts,ts,uploadId,ts).first<Record<string,unknown>>();
  if(!claimed)return new Response("Upload already claimed",{status:409});
  try{
    // R2 rejects TransformStream bodies because the transformed readable loses its known length.
    // Preserve the original Request body when Content-Length is known; otherwise buffer safely
    // up to maxBytes and upload a Uint8Array, whose length is explicit.
    let uploadBody: ReadableStream<Uint8Array> | Uint8Array = request.body;
    let storedLength = length;
    if (!(length > 0)) {
      const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let seen=0;
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        if(!value)continue;
        seen+=value.byteLength;
        if(seen>maxBytes)throw new Error("FILE_TOO_LARGE");
        chunks.push(value);
      }
      const buffered=new Uint8Array(seen); let offset=0;
      for(const chunk of chunks){buffered.set(chunk,offset); offset+=chunk.byteLength;}
      uploadBody=buffered; storedLength=seen;
    }
    await env.MEDIA.put(String(claimed.r2_key),uploadBody,{httpMetadata:{contentType:actualMime},customMetadata:{uploadId,uploadType:String(claimed.upload_type)}});
    const object=await env.MEDIA.head(String(claimed.r2_key)); const size=Number(object?.size||storedLength||0); const done=nowMs();
    await env.DB.prepare("UPDATE v2_direct_uploads SET status='STORED',actual_mime=?,size_bytes=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='UPLOADING'").bind(actualMime,size,done,uploadId).run();
    return new Response(JSON.stringify({ok:true,uploadId,status:"STORED",sizeBytes:size,mimeType:actualMime}),{status:201,headers:{"content-type":"application/json"}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error); const failedAt=nowMs();
    await env.DB.prepare("UPDATE v2_direct_uploads SET status=CASE WHEN expires_at>=? THEN 'PREPARED' ELSE 'EXPIRED' END,failure_reason=?,updated_at=? WHERE id=? AND status='UPLOADING'").bind(failedAt,message.slice(0,1000),failedAt,uploadId).run();
    throw error;
  }
}

export async function confirmDirectUpload(env:Env,uploadId:string) {
  const ts=nowMs();
  let row=await env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();
  if(!row)return {error:"NOT_FOUND",status:404} as const;
  if(String(row.status)==="CONFIRMED") {
    if(String(row.upload_type)==="IMPORT_ZIP") {
      const imported=await env.DB.prepare("SELECT id,status FROM imports WHERE r2_key=? ORDER BY created_at DESC LIMIT 1").bind(row.r2_key).first<{id:string;status:string}>();
      return {ok:true,idempotent:true,importId:imported?.id||null,importStatus:imported?.status||null,status:200} as const;
    }
    return {ok:true,idempotent:true,candidateId:row.candidate_id||null,projectFileId:row.project_file_id||null,status:200} as const;
  }
  if(String(row.status)==="CONFIRMING"&&Number(row.updated_at||0)<ts-5*60_000){
    await env.DB.prepare("UPDATE v2_direct_uploads SET status='STORED',failure_reason='STALE_CONFIRM_RECOVERED',updated_at=? WHERE id=? AND status='CONFIRMING' AND updated_at<?").bind(ts,uploadId,ts-5*60_000).run();
    row=await env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();
  }
  if(!row)return {error:"NOT_FOUND",status:404} as const;
  if(String(row.status)!=="STORED")return {error:"INVALID_STATE",currentStatus:row.status,status:409} as const;
  const object=await env.MEDIA.head(String(row.r2_key)); if(!object)return {error:"OBJECT_MISSING",status:409} as const;
  const claimed=await env.DB.prepare("UPDATE v2_direct_uploads SET status='CONFIRMING',last_attempt_at=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='STORED' RETURNING *").bind(ts,ts,uploadId).first<Record<string,unknown>>();
  if(!claimed){
    const latest=await env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();
    if(String(latest?.status)==="CONFIRMED")return {ok:true,idempotent:true,candidateId:latest?.candidate_id||null,projectFileId:latest?.project_file_id||null,status:200} as const;
    return {error:"CONFIRM_ALREADY_CLAIMED",currentStatus:latest?.status,status:409} as const;
  }
  try{
    if(String(claimed.upload_type)==="IMPORT_ZIP") {
      const importId=id("IMP");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO imports (id,file_name,r2_key,size_bytes,status,created_at,manifest_text,warnings) VALUES (?,?,?,?,'Recebido',?,NULL,'[]')").bind(importId,claimed.file_name,claimed.r2_key,claimed.size_bytes,ts),
        env.DB.prepare("UPDATE v2_direct_uploads SET status='CONFIRMED',failure_reason=NULL,updated_at=?,completed_at=? WHERE id=? AND status='CONFIRMING'").bind(ts,ts,uploadId),
      ]);
      await writeImportRecoveryRecord(env,importId,"DIRECT_ZIP_RECEIVED").catch(()=>undefined);
      await refreshRecoveryAfterWrite(env,"DIRECT_ZIP_RECEIVED",importId);
      return {ok:true,importId,r2Key:claimed.r2_key,status:200} as const;
    }
    if(String(claimed.upload_type)==="PROJECT_FILE") {
      if(!claimed.project_id)throw new Error("PROJECT_REQUIRED");
      const project=await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=?").bind(claimed.project_id).first(); if(!project)throw new Error("PROJECT_NOT_FOUND");
      const max=await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM automatic_project_files WHERE project_id=? AND role=?").bind(claimed.project_id,claimed.role||"ANEXO").first<{version:number}>();
      const fileId=id("PF");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO automatic_project_files (id,project_id,role,version,file_name,r2_key,mime_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(fileId,claimed.project_id,claimed.role||"ANEXO",Number(max?.version||0)+1,claimed.file_name,claimed.r2_key,claimed.actual_mime||claimed.expected_mime||"application/octet-stream",claimed.size_bytes,ts),
        env.DB.prepare("UPDATE v2_direct_uploads SET status='CONFIRMED',project_file_id=?,failure_reason=NULL,updated_at=?,completed_at=? WHERE id=? AND status='CONFIRMING'").bind(fileId,ts,ts,uploadId),
        env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),claimed.project_id,"FILE_ATTACHED","OK",JSON.stringify({fileId,role:claimed.role||"ANEXO",fileName:claimed.file_name,mcpVisibility:"IMMEDIATE"}),ts),
        env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,claimed.project_id),
      ]);
      let scriptParse:unknown=null;
      let reconciliation:unknown=null;
      if(String(claimed.role||"").trim().toUpperCase()==="SCRIPT" && Number(claimed.size_bytes||0)<=2*1024*1024){
        const stored=await env.MEDIA.get(String(claimed.r2_key));
        if(stored){
          const content=await stored.text();
          scriptParse=await materializeScenesFromProjectScript(env,{projectId:String(claimed.project_id),content,fileId,fileName:String(claimed.file_name||"SCRIPT.txt")}).catch(error=>({ok:false,error:error instanceof Error?error.message:String(error),sceneCount:0}));
          if(Number((scriptParse as any)?.sceneCount||0)>0)reconciliation=await reconcileAutomaticProject(env,String(claimed.project_id)).catch(error=>({error:error instanceof Error?error.message:String(error)}));
        }
      }
      return {ok:true,projectFileId:fileId,r2Key:claimed.r2_key,mcpVisible:true,script_parse:scriptParse,reconciliation,status:200} as const;
    }
    const operationId=id("OP"); const candidateId=id("CAND");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_ingest_operations (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at) VALUES (?,'DIRECT_UPLOAD','COMPLETED',1,1,0,?, ?,?)").bind(operationId,JSON.stringify({uploadId}),ts,ts),
      env.DB.prepare(`INSERT INTO v2_ingest_candidates (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,r2_key,mime_type,size_bytes,failure_reason,attempts,created_at,updated_at,discovered_at,queued_at,download_started_at,materialized_at,queue_wait_ms,download_ms,r2_write_ms,d1_finalize_ms,total_materialization_ms) VALUES (?,?,?,?,?,?,?,?, 'MATERIALIZED',?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(candidateId,operationId,`direct-upload://${uploadId}`,claimed.project_id||null,claimed.item_id||null,claimed.universe||"",claimed.subject||"",claimed.tags_json||"[]",claimed.r2_key,claimed.actual_mime||claimed.expected_mime||"application/octet-stream",claimed.size_bytes,null,ts,ts,ts,ts,ts,ts,0,0,0,0,0),
      env.DB.prepare("UPDATE v2_direct_uploads SET status='CONFIRMED',candidate_id=?,failure_reason=NULL,updated_at=?,completed_at=? WHERE id=? AND status='CONFIRMING'").bind(candidateId,ts,ts,uploadId),
    ]);
    if(claimed.project_id)await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,claimed.project_id).run().catch(()=>undefined);
    await writeCandidateRecoveryRecord(env,candidateId,"DIRECT_UPLOAD_CONFIRMED").catch(()=>undefined);
    await refreshRecoveryAfterWrite(env,"DIRECT_IMAGE_RECEIVED",candidateId);
    await refreshProjectItemPipelineState(env,claimed.project_id?String(claimed.project_id):null,claimed.item_id?String(claimed.item_id):null).catch(()=>undefined);
    await recordIngestEvent(env,operationId,candidateId,"DIRECT_UPLOAD_CONFIRMED","MATERIALIZED",String(claimed.r2_key),null);
    return {ok:true,candidateId,operationId,r2Key:claimed.r2_key,status:200} as const;
  }catch(error){
    const message=error instanceof Error?error.message:String(error); const failedAt=nowMs();
    await env.DB.prepare("UPDATE v2_direct_uploads SET status='STORED',failure_reason=?,updated_at=? WHERE id=? AND status='CONFIRMING'").bind(message.slice(0,1000),failedAt,uploadId).run();
    if(message==="PROJECT_REQUIRED")return {error:"PROJECT_REQUIRED",status:400} as const;
    if(message==="PROJECT_NOT_FOUND")return {error:"PROJECT_NOT_FOUND",status:404} as const;
    throw error;
  }
}

export async function getDirectUpload(env:Env,uploadId:string){return env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();}
