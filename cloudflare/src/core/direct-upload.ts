import type { Env } from "../types";
import { createSignedUploadUrl, validSignedUploadRequest } from "./auth";
import { id, nowMs, stableId } from "./ids";
import { recordIngestEvent } from "./materialization";
import { refreshProjectItemPipelineState } from "./project-pipeline-state";
import { refreshRecoveryAfterWrite, writeCandidateRecoveryRecord, writeImportRecoveryRecord } from "./recovery-manifest";
import { materializeScenesFromProjectScript } from "./project-script-parser";
import { reconcileAutomaticProject } from "./projects";
import { createProjectMediaFromCandidate } from "./production";
import { setProjectProfileFromCandidate } from "./project-profile";

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
    const directTags=normalizeTags((()=>{try{return JSON.parse(String(claimed.tags_json||"[]"));}catch{return [];}})()).map(tag=>tag.toLowerCase());
    let projectMedia:unknown=null;
    if(claimed.project_id && directTags.includes("project-profile")) {
      projectMedia=await setProjectProfileFromCandidate(env,{projectId:String(claimed.project_id),candidateId,origin:"DIRECT_UPLOAD_PROJECT_PROFILE"}).catch(error=>({error:error instanceof Error?error.message:String(error)}));
    } else if(claimed.project_id && directTags.includes("thumb")) {
      projectMedia=await createProjectMediaFromCandidate(env,{candidateId,projectId:String(claimed.project_id),r2Key:String(claimed.r2_key),mimeType:String(claimed.actual_mime||claimed.expected_mime||"image/jpeg"),sizeBytes:Number(claimed.size_bytes||0),sourceUrl:`direct-upload://${uploadId}`,agentOrigin:"DIRECT_UPLOAD_THUMB"}).catch(error=>({error:error instanceof Error?error.message:String(error)}));
    }
    await recordIngestEvent(env,operationId,candidateId,"DIRECT_UPLOAD_CONFIRMED","MATERIALIZED",String(claimed.r2_key),null);
    return {ok:true,candidateId,operationId,r2Key:claimed.r2_key,projectMedia,status:200} as const;
  }catch(error){
    const message=error instanceof Error?error.message:String(error); const failedAt=nowMs();
    await env.DB.prepare("UPDATE v2_direct_uploads SET status='STORED',failure_reason=?,updated_at=? WHERE id=? AND status='CONFIRMING'").bind(message.slice(0,1000),failedAt,uploadId).run();
    if(message==="PROJECT_REQUIRED")return {error:"PROJECT_REQUIRED",status:400} as const;
    if(message==="PROJECT_NOT_FOUND")return {error:"PROJECT_NOT_FOUND",status:404} as const;
    throw error;
  }
}

export async function getDirectUpload(env:Env,uploadId:string){return env.DB.prepare("SELECT * FROM v2_direct_uploads WHERE id=?").bind(uploadId).first<Record<string,unknown>>();}


const MAX_MCP_THUMB_BYTES = 24 * 1024 * 1024;

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value=obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function decodeBase64Bytes(value: string) {
  const normalized=value.replace(/^data:[^,]*;base64,/i,"").replace(/\s+/g,"");
  if (!normalized || normalized.length % 4 === 1) throw new Error("FILE_BASE64_INVALID");
  let binary="";
  try { binary=atob(normalized); } catch { throw new Error("FILE_BASE64_INVALID"); }
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function sniffImageMime(bytes: Uint8Array) {
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return"image/jpeg";
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return"image/png";
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return"image/webp";
  if(bytes.length>=6&&String.fromCharCode(...bytes.slice(0,6)).startsWith("GIF8"))return"image/gif";
  return"";
}

function nestedFileObjects(value: unknown) {
  const out:Record<string,unknown>[]=[],seen=new Set<unknown>();
  const visit=(current:unknown,depth:number)=>{
    if(depth>4||current===null||current===undefined||seen.has(current))return;
    if(current instanceof Uint8Array||current instanceof ArrayBuffer)return;
    if(Array.isArray(current)){
      // Byte arrays are payloads, not object graphs. Only recurse into structured arrays.
      if(current.length&&current.length<=MAX_MCP_THUMB_BYTES&&current.every(v=>typeof v==="number"))return;
      for(const child of current.slice(0,32))visit(child,depth+1);
      return;
    }
    if(typeof current!=="object")return;
    seen.add(current);const obj=current as Record<string,unknown>;out.push(obj);
    for(const key of ["file","arquivo","attachment","resource","data","content","input","value"]){const child=obj[key];if(child!==undefined)visit(child,depth+1);}
  };
  visit(value,0);return out;
}

function inlineBytesFromFileObject(value: unknown): {bytes:Uint8Array;mimeHint:string;fileName:string}|null {
  const objects=nestedFileObjects(value);
  for(const obj of objects){
    const fileName=firstString(obj,["name","filename","file_name","display_name"])||"thumb-upload.bin";
    const mimeHint=firstString(obj,["mime_type","mimeType","content_type","contentType","type"]);
    for(const key of ["base64","base64_data","content_base64","data_base64","blob"]){const raw=obj[key];if(typeof raw==="string"&&raw.trim())return{bytes:decodeBase64Bytes(raw),mimeHint,fileName};}
    for(const key of ["data","content","bytes","body"]){
      const raw=obj[key];
      if(typeof raw==="string"&&raw.trim()){
        if(/^data:[^,]+;base64,/i.test(raw))return{bytes:decodeBase64Bytes(raw),mimeHint:fileName?mimeHint:firstString(obj,["type"]),fileName};
        const encoding=firstString(obj,["encoding","content_encoding","contentEncoding"]).toLowerCase();
        if(encoding==="base64")return{bytes:decodeBase64Bytes(raw),mimeHint,fileName};
      }
      if(Array.isArray(raw)&&raw.length&&raw.length<=MAX_MCP_THUMB_BYTES){
        const nums=raw.map(Number);if(nums.every(n=>Number.isInteger(n)&&n>=0&&n<=255))return{bytes:new Uint8Array(nums),mimeHint,fileName};
      }
      if(raw instanceof Uint8Array)return{bytes:raw,mimeHint,fileName};
    }
  }
  return null;
}

async function binaryObjectBytes(value: unknown):Promise<{bytes:Uint8Array;mimeHint:string;fileName:string}|null>{
  if(value instanceof Uint8Array)return{bytes:value,mimeHint:"",fileName:"thumb-upload.bin"};
  if(value instanceof ArrayBuffer)return{bytes:new Uint8Array(value),mimeHint:"",fileName:"thumb-upload.bin"};
  for(const obj of nestedFileObjects(value)){
    const fileName=firstString(obj,["name","filename","file_name","display_name"])||"thumb-upload.bin";
    const mimeHint=firstString(obj,["mime_type","mimeType","content_type","contentType","type"]);
    const maybeArrayBuffer=(obj as Record<string,unknown>)["arrayBuffer"];
    if(typeof maybeArrayBuffer==="function"){
      try{const raw=await (maybeArrayBuffer as ()=>Promise<ArrayBuffer>).call(obj);if(raw instanceof ArrayBuffer)return{bytes:new Uint8Array(raw),mimeHint,fileName};}catch{}
    }
  }
  return null;
}

function remoteUrlFromFileObject(value: unknown) {
  for(const obj of nestedFileObjects(value)){
    const url=firstString(obj,["download_url","downloadUrl","url","href","uri","file_url","fileUrl"]);
    if(/^https?:\/\//i.test(url))return url;
  }
  return "";
}

async function sha256Bytes(bytes:Uint8Array){const digest=await crypto.subtle.digest("SHA-256",bytes);return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}

async function persistMcpThumbBytes(env:Env,input:{projectId:string;bytes:Uint8Array;fileName:string;mimeHint?:string;sourceUrl?:string;agentOrigin?:string}){
  const project=await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=?").bind(input.projectId).first();
  if(!project)return{error:"PROJECT_NOT_FOUND",status:404}as const;
  if(!input.bytes.byteLength)return{error:"FILE_EMPTY",status:400}as const;
  if(input.bytes.byteLength>MAX_MCP_THUMB_BYTES)return{error:"FILE_TOO_LARGE",status:413,max_bytes:MAX_MCP_THUMB_BYTES,size_bytes:input.bytes.byteLength}as const;
  const sniffed=sniffImageMime(input.bytes),claimed=String(input.mimeHint||"").split(";")[0].trim().toLowerCase();
  if(!sniffed)return{error:"THUMB_IMAGE_REQUIRED",status:415,claimed_mime:claimed||null}as const;
  if(claimed&&claimed.startsWith("image/")&&claimed!==sniffed&&!(claimed==="image/jpg"&&sniffed==="image/jpeg"))return{error:"THUMB_MIME_MISMATCH",status:415,claimed_mime:claimed,actual_mime:sniffed}as const;
  const hash=await sha256Bytes(input.bytes),candidateId=await stableId("CAND",`MCP_THUMB_FILE\n${input.projectId}\n${hash}`,12),operationId=await stableId("OP",`MCP_THUMB_FILE\n${input.projectId}\n${hash}`,12),safe=sanitizeFilename(input.fileName||`thumb-${hash.slice(0,12)}.bin`),r2Key=`incoming/mcp-thumb/${input.projectId}/${candidateId}/${safe}`;
  const existingMedia=await env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND metadata_json LIKE ? LIMIT 1").bind(input.projectId,`%${candidateId}%`).first<Record<string,unknown>>();
  if(existingMedia)return{ok:true,idempotent:true,project_id:input.projectId,candidate_id:candidateId,media:existingMedia,status:"THUMB_ATTACHED",source_mode:"INLINE_FILE_BYTES"}as const;
  const activeThumbs=await env.DB.prepare("SELECT COUNT(*) total FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND status NOT IN ('REJECTED','THUMB_REJECTED')").bind(input.projectId).first<Record<string,unknown>>();
  if(Number(activeThumbs?.total||0)>=3)return{error:"THUMB_SLOTS_FULL",status:409,project_id:input.projectId,max:3}as const;
  if(!(await env.MEDIA.head(r2Key)))await env.MEDIA.put(r2Key,input.bytes,{httpMetadata:{contentType:sniffed},customMetadata:{projectId:input.projectId,candidateId,source:"MCP_FILE_OBJECT",sha256:hash}});
  const ts=nowMs();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO v2_ingest_operations (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at) VALUES (?,'MCP_THUMB_FILE','COMPLETED',1,1,0,?,?,?)").bind(operationId,JSON.stringify({projectId:input.projectId,fileName:safe,sha256:hash,sourceUrl:input.sourceUrl||null}),ts,ts),
    env.DB.prepare(`INSERT OR IGNORE INTO v2_ingest_candidates (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,r2_key,mime_type,size_bytes,failure_reason,attempts,created_at,updated_at,discovered_at,queued_at,download_started_at,materialized_at,queue_wait_ms,download_ms,r2_write_ms,d1_finalize_ms,total_materialization_ms) VALUES (?,?,?,?,NULL,'','THUMB',?,'MATERIALIZED',?,?,?,NULL,0,?,?,?,?,?,?,0,0,0,0,0)`).bind(candidateId,operationId,input.sourceUrl||`mcp-file://${candidateId}`,input.projectId,JSON.stringify(["thumb","mcp-file"]),r2Key,sniffed,input.bytes.byteLength,ts,ts,ts,ts,ts,ts),
  ]);
  const media=await createProjectMediaFromCandidate(env,{candidateId,projectId:input.projectId,r2Key,mimeType:sniffed,sizeBytes:input.bytes.byteLength,sourceUrl:input.sourceUrl||`mcp-file://${candidateId}`,name:safe,agentOrigin:input.agentOrigin||"MCP_THUMB_FILE"});
  if((media as any)?.error)return media as any;
  await recordIngestEvent(env,operationId,candidateId,"MCP_THUMB_FILE_ATTACHED","MATERIALIZED",r2Key,null).catch(()=>undefined);
  await writeCandidateRecoveryRecord(env,candidateId,"MCP_THUMB_FILE_ATTACHED").catch(()=>undefined);
  await refreshRecoveryAfterWrite(env,"MCP_THUMB_FILE_ATTACHED",candidateId).catch(()=>undefined);
  return{ok:true,project_id:input.projectId,candidate_id:candidateId,operation_id:operationId,media,status:"THUMB_ATTACHED",source_mode:"INLINE_FILE_BYTES",mime_type:sniffed,size_bytes:input.bytes.byteLength,sha256:hash,no_external_put:true,no_public_url_required:true}as const;
}

export async function attachProjectThumbFromFileObject(env:Env,input:{projectId:string;file:unknown;name?:string;agentOrigin?:string}){
  if(typeof input.file==="string"&&input.file.trim()){const raw=input.file.trim();if(/^data:image\/[^;]+;base64,/i.test(raw))return persistMcpThumbBytes(env,{projectId:input.projectId,bytes:decodeBase64Bytes(raw),fileName:input.name||"thumb-upload.bin",mimeHint:raw.slice(5,raw.indexOf(";")),agentOrigin:input.agentOrigin});if(/^https?:\/\//i.test(raw)){input={...input,file:{url:raw}};}}
  const inline=inlineBytesFromFileObject(input.file);
  if(inline){return persistMcpThumbBytes(env,{projectId:input.projectId,bytes:inline.bytes,fileName:input.name||inline.fileName,mimeHint:inline.mimeHint,agentOrigin:input.agentOrigin});}
  const binary=await binaryObjectBytes(input.file);
  if(binary){return persistMcpThumbBytes(env,{projectId:input.projectId,bytes:binary.bytes,fileName:input.name||binary.fileName,mimeHint:binary.mimeHint,agentOrigin:input.agentOrigin});}
  const remote=remoteUrlFromFileObject(input.file);
  if(remote){
    const response=await fetch(remote,{redirect:"follow",signal:AbortSignal.timeout(20_000),headers:{"user-agent":"CorvoLibraryV2-MCP-Thumb/1.0"}}).catch(()=>null);
    if(!response||!response.ok)return{error:"THUMB_FILE_FETCH_FAILED",status:409,url:remote,http_status:response?.status||null}as const;
    const length=Number(response.headers.get("content-length")||0);if(length>MAX_MCP_THUMB_BYTES)return{error:"FILE_TOO_LARGE",status:413,max_bytes:MAX_MCP_THUMB_BYTES,size_bytes:length}as const;
    const bytes=new Uint8Array(await response.arrayBuffer());
    return persistMcpThumbBytes(env,{projectId:input.projectId,bytes,fileName:input.name||remote.split("/").pop()||"thumb-upload.bin",mimeHint:response.headers.get("content-type")||undefined,sourceUrl:remote,agentOrigin:input.agentOrigin});
  }
  const root=recordObject(input.file),fileName=input.name||firstString(root,["name","filename","file_name"])||"thumb-upload.bin";
  return{error:"FILE_BYTES_UNAVAILABLE",status:400,project_id:input.projectId,file_name:fileName,required:"arquivo com bytes/base64/data URI ou URL HTTPS acessível",accepted_shapes:["arquivo.base64","arquivo.data(data:...;base64,...)","File/Blob com arrayBuffer()","arquivo.base64/blob","arquivo.data(data:...;base64,...)","arquivo.bytes:number[]","arquivo.download_url/url/href/uri:https://..."],ticket_required:false,recommendation:"ChatGPT connector should pass the mounted file as the tool file argument so its bytes/reference are rewritten into arquivo."}as const;
}
