import type { Env } from '../types';
import { getAssetLink } from '../core/assets';
import DEFAULT_QUIZ_PROJECT from './default-project';

export const COMMANDS = ['get_schema','get_state','get_project','get_scene','summary','apply','set_scene','apply_batch','set_many','apply_placement','set_scene_placement','set_active_scene','add_scene','add_text_scene','duplicate_scene','delete_scene','move_scene','replace_project','set_audio','reset_scene','set_selection','apply_to_selection','auto_layout','get_coordinates','get_visual','export_scene','export_scene_package','export_png','export_scene_mp4','export_project_mp4','export_project','get_diagnostics','present','stop_present','set_control','set_playback','set_editor_visible','import_scenes','export_overlay_placement'] as const;
const READ_COMMANDS = new Set(['get_schema','get_state','get_project','get_scene','summary','get_coordinates','get_visual','export_scene','export_scene_package','export_png','export_scene_mp4','export_project_mp4','export_project','get_diagnostics','present','stop_present','set_selection']);
export class QuizError extends Error { constructor(message:string, public status=400) { super(message); } }
const safeId = (v:unknown) => { if(typeof v!=='string'||! /^[\w-]{1,100}$/.test(v))throw new QuizError('INVALID_ID');return v; };
const json = (v:unknown) => JSON.stringify(v);
const uuid = () => crypto.randomUUID();
let ready: Promise<void>|undefined;
export function ensureQuiz(env:Env) {
  return ready ||= (async()=>{await env.DB.exec(`CREATE TABLE IF NOT EXISTS quiz_documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT,revision INTEGER NOT NULL DEFAULT 0,snapshot_key TEXT,summary_json TEXT NOT NULL DEFAULT '{}',updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_jobs(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,request_json TEXT NOT NULL,status TEXT NOT NULL,expected_revision INTEGER,client_id TEXT NOT NULL,owner TEXT,lease_until INTEGER,result_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(document_id,client_id));
CREATE INDEX IF NOT EXISTS quiz_jobs_queue ON quiz_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS quiz_jobs_document ON quiz_jobs(document_id,status);
CREATE TABLE IF NOT EXISTS quiz_media(id TEXT PRIMARY KEY,r2_key TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_uploads(id TEXT PRIMARY KEY,r2_key TEXT NOT NULL,upload_id TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_executors(id TEXT PRIMARY KEY,seen_at INTEGER NOT NULL);`);
    // A fresh installation is immediately useful to both the manual editor and MCP.
    // The snapshot is bundled code, not a chat materialization.
    const existing=await env.DB.prepare('SELECT id FROM quiz_documents WHERE id=?').bind('quiz-teste').first();
    if(!existing){
      const key='quiz/snapshots/quiz-teste/initial-v1.json';
      await env.MEDIA.put(key,json(DEFAULT_QUIZ_PROJECT),{httpMetadata:{contentType:'application/json'}});
      await env.DB.prepare('INSERT OR IGNORE INTO quiz_documents(id,title,revision,snapshot_key,summary_json,updated_at) VALUES(?,?,?,?,?,?)').bind('quiz-teste','Quiz Teste',1,key,json({total_scenes:1,active_scene:1,format:'16:9',initialized:true}),Date.now()).run();
    }
  })().catch(e=>{ready=undefined;throw e;});
}
async function doc(env:Env,id:unknown):Promise<any>{const row=await env.DB.prepare('SELECT * FROM quiz_documents WHERE id=?').bind(safeId(id)).first();if(!row)throw new QuizError('QUIZ_NOT_FOUND',404);return row;}
async function snapshot(env:Env,row:any){if(!row.snapshot_key)return null;const obj=await env.MEDIA.get(row.snapshot_key);if(!obj)throw new QuizError('SNAPSHOT_MISSING',503);return JSON.parse(await obj.text());}
function validateCommand(c:any, batch=false) {
  if(!c||!COMMANDS.includes(c.op))throw new QuizError('UNKNOWN_COMMAND');
  if(c.scene!==undefined && c.op!=='add_scene' && (!Number.isInteger(c.scene)||c.scene<1))throw new QuizError('INVALID_SCENE');
  if(['apply_batch','set_many'].includes(c.op)){
    if(batch)throw new QuizError('NESTED_BATCH_NOT_ALLOWED');
    const ops=c.operations||c.ops;if(!Array.isArray(ops)||!ops.length||ops.length>200)throw new QuizError('BATCH_REQUIRES_1_TO_200_OPERATIONS');
    for(const op of ops){validateCommand(op,true);if(READ_COMMANDS.has(op.op)||['replace_project','set_audio'].includes(op.op))throw new QuizError('BATCH_SCENE_EDITS_ONLY');}
  }
  if(json(c).length>2_000_000)throw new QuizError('COMMAND_TOO_LARGE_USE_ASSET_IDS',413);
  // Do not accept object keys used for prototype mutation at any nesting level.
  const walk=(v:any)=>{if(v&&typeof v==='object')for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))throw new QuizError('UNSAFE_KEY');walk(v[k]);}};walk(c);
}
export async function rendererStatus(env:Env){
  if(env.BROWSER){try{const r=await env.BROWSER.fetch('https://cloudflare.browser/v1/limits');if(r.ok)return {online:true,mode:'CLOUDFLARE_BROWSER_RENDERING',browser_closed_ok:true};}catch{/* external executor fallback below */}}
  const r=await env.DB.prepare('SELECT MAX(seen_at) AS seen FROM quiz_executors').first<any>();
  const online=Number(r?.seen||0)>Date.now()-30_000;
  return {online,mode:online?'EXTERNAL_EXECUTOR':'UNAVAILABLE',browser_closed_ok:online};
}
async function executorOnline(env:Env){return (await rendererStatus(env)).online;}
export async function quizRpc(env:Env, request:Request, op:string, p:any={}):Promise<any>{
  await ensureQuiz(env);
  if(op==='upload-start'){
    if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/mp4','application/json','text/plain','image/svg+xml'].includes(p.mime)||!Number.isInteger(p.size)||p.size<1||p.size>5_000_000_000)throw new QuizError('INVALID_UPLOAD');
    const id=uuid(),key=`quiz/media/${id}`,upload=await env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:p.mime}});
    await env.DB.prepare('INSERT INTO quiz_uploads(id,r2_key,upload_id,mime,size,created_at) VALUES(?,?,?,?,?,?)').bind(id,key,upload.uploadId,p.mime,p.size,Date.now()).run();return {ok:true,id};
  }
  if(op==='upload-finish'||op==='upload-abort'){
    const u:any=await env.DB.prepare('SELECT * FROM quiz_uploads WHERE id=?').bind(safeId(p.id)).first();if(!u)throw new QuizError('UPLOAD_NOT_FOUND',404);
    const upload=env.MEDIA.resumeMultipartUpload(u.r2_key,u.upload_id);
    if(op==='upload-abort'){await upload.abort();await env.DB.prepare('DELETE FROM quiz_uploads WHERE id=?').bind(u.id).run();return {ok:true};}
    if(!Array.isArray(p.parts)||!p.parts.length||p.parts.length>1000||p.parts.some((x:any,i:number)=>x.partNumber!==i+1||typeof x.etag!=='string'))throw new QuizError('INVALID_PARTS');
    const object=await upload.complete(p.parts);if(object.size!==u.size){await env.MEDIA.delete(u.r2_key);throw new QuizError('UPLOAD_SIZE_MISMATCH');}
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO quiz_media(id,r2_key,mime,size,created_at) VALUES(?,?,?,?,?)').bind(u.id,u.r2_key,u.mime,u.size,Date.now()),env.DB.prepare('DELETE FROM quiz_uploads WHERE id=?').bind(u.id)]);
    return {ok:true,id:u.id,url:`${new URL(request.url).origin}/quiz/media/${u.id}`,mime:u.mime,size:u.size};
  }
  if(op==='catalog'){const renderer=await rendererStatus(env);return {ok:true,commands:COMMANDS,batch_limit:200,scene_index:'1-based',default_quiz_id:'quiz-teste',workflow:'read quiz-teste → execute (request_id) → job until SUCCEEDED → inspect result URLs; same request_id prevents duplicate submission',reads:'read returns persisted state immediately; get_schema gives ALL editable fields from the real editor',renderer_online:renderer.online,renderer,approval:'Uses existing Library MCP. No chat file/materialization tools. Client approval policies remain controlled by the client.'};}
  if(op==='list'){const limit=Math.min(100,Math.max(1,Number(p.limit)||30));const r=await env.DB.prepare('SELECT id,title,project_id,revision,summary_json,updated_at FROM quiz_documents ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?').bind(limit,Math.max(0,Number(p.offset)||0)).all<any>();return {ok:true,items:r.results.map(({summary_json,...r})=>({...r,summary:JSON.parse(summary_json)})),renderer_online:await executorOnline(env)};}
  if(op==='create'){
    const id=p.id?safeId(p.id):uuid();if(p.project_id){const project=await env.DB.prepare('SELECT id FROM automatic_projects WHERE id=?').bind(p.project_id).first();if(!project)throw new QuizError('LIBRARY_PROJECT_NOT_FOUND',404);}
    const key=`quiz/snapshots/${id}/initial-v1.json`;await env.MEDIA.put(key,json(DEFAULT_QUIZ_PROJECT),{httpMetadata:{contentType:'application/json'}});
    await env.DB.prepare('INSERT OR IGNORE INTO quiz_documents(id,title,project_id,revision,snapshot_key,summary_json,updated_at) VALUES(?,?,?,1,?,?,?)').bind(id,String(p.title||'Quiz Teste').slice(0,160),p.project_id||null,key,json({total_scenes:1,active_scene:1,format:'16:9',initialized:true}),Date.now()).run();return {ok:true,id,revision:(await doc(env,id)).revision,initialized:true};
  }
  if(op==='read'){
    const row=await doc(env,p.id);if(p.if_revision===row.revision)return {ok:true,id:row.id,revision:row.revision,changed:false};
    const base={ok:true,id:row.id,title:row.title,revision:row.revision,summary:JSON.parse(row.summary_json)};
    if(!p.full&&!p.scene&&!p.scenes)return base;
    const data=await snapshot(env,row);if(!data)return {...base,project:null,initialized:false};
    if(p.scene){if(!Number.isInteger(p.scene)||!data.scenes[p.scene-1])throw new QuizError('INVALID_SCENE');return {...base,scene:data.scenes[p.scene-1]};}
    if(p.full)return {...base,project:data};
    return {...base,scenes:data.scenes.slice(Math.max(0,Number(p.offset)||0),Math.max(0,Number(p.offset)||0)+Math.min(50,Number(p.limit)||10)),total:data.scenes.length};
  }
  if(op==='execute'){
    validateCommand(p.command);const row=await doc(env,p.id);const client=safeId(p.request_id);const existing=await env.DB.prepare('SELECT id,status FROM quiz_jobs WHERE document_id=? AND client_id=?').bind(row.id,client).first();if(existing)return {ok:true,...existing,deduplicated:true};
    if(p.expected_revision!==undefined&&p.expected_revision!==row.revision)throw new QuizError('REVISION_CONFLICT',409);
    const id=uuid(),now=Date.now();await env.DB.prepare("INSERT OR IGNORE INTO quiz_jobs(id,document_id,request_json,status,expected_revision,client_id,created_at,updated_at) VALUES(?,?,?,'QUEUED',?,?,?,?)").bind(id,row.id,json(p.command),p.expected_revision??null,client,now,now).run();
    const actual:any=await env.DB.prepare('SELECT id,status FROM quiz_jobs WHERE document_id=? AND client_id=?').bind(row.id,client).first();
    if(actual?.id&&env.MATERIALIZE_QUEUE)await env.MATERIALIZE_QUEUE.send({kind:'QUIZ_JOB',jobId:String(actual.id),coreOrigin:new URL(request.url).origin});
    return {ok:true,...actual,renderer_online:await executorOnline(env),poll_after_ms:1000};
  }
  if(op==='job'){
    const row:any=await env.DB.prepare('SELECT id,document_id,status,result_json,updated_at FROM quiz_jobs WHERE id=?').bind(safeId(p.job_id)).first();if(!row)throw new QuizError('JOB_NOT_FOUND',404);const {result_json,...rest}=row;return {ok:true,...rest,result:result_json?JSON.parse(result_json):null};
  }
  if(op==='cancel'){
    const r=await env.DB.prepare("UPDATE quiz_jobs SET status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,updated_at=? WHERE id=? AND status IN ('QUEUED','RUNNING')").bind(Date.now(),safeId(p.job_id)).run();return {ok:true,changed:Number(r.meta.changes||0)};
  }
  if(op==='asset.resolve')return (await getAssetLink(request,safeId(p.asset_id),env,3600))||{ok:false,error:'ASSET_NOT_FOUND'};
  if(op==='save'){
    const row=await doc(env,p.id);if(!Number.isInteger(p.expected_revision)||row.revision!==p.expected_revision)throw new QuizError('REVISION_CONFLICT',409);
    if(!p.project||!Array.isArray(p.project.scenes)||!p.project.scenes.length||p.project.scenes.length>1000)throw new QuizError('INVALID_PROJECT');
    const content=json(p.project);if(content.length>8_000_000)throw new QuizError('SNAPSHOT_TOO_LARGE_UPLOAD_MEDIA_FIRST',413);
    const key=`quiz/snapshots/${row.id}/${uuid()}.json`;await env.MEDIA.put(key,content,{httpMetadata:{contentType:'application/json'}});
    const r=await env.DB.prepare('UPDATE quiz_documents SET snapshot_key=?,summary_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(key,json(p.summary||{}),Date.now(),row.id,p.expected_revision).run();
    if(!r.meta.changes){await env.MEDIA.delete(key);throw new QuizError('REVISION_CONFLICT',409);}return {ok:true,revision:row.revision+1};
  }
  // The following endpoints are reached only through the existing authenticated app/renderer channel.
  if(op==='claim-job'){
    const owner=safeId(p.owner),jobId=safeId(p.job_id),now=Date.now();
    await env.DB.prepare('INSERT INTO quiz_executors(id,seen_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at').bind(owner,now).run();
    const row:any=await env.DB.prepare(`UPDATE quiz_jobs SET status='RUNNING',owner=?,lease_until=?,updated_at=? WHERE id=? AND status='QUEUED' AND NOT EXISTS(SELECT 1 FROM quiz_jobs busy WHERE busy.document_id=quiz_jobs.document_id AND busy.id<>quiz_jobs.id AND busy.status IN ('RUNNING','CANCEL_REQUESTED')) RETURNING *`).bind(owner,now+14*60_000,now,jobId).first();
    if(!row){const pending:any=await env.DB.prepare('SELECT status FROM quiz_jobs WHERE id=?').bind(jobId).first();return {ok:true,job:null,status:pending?.status||'MISSING'};}const d=await doc(env,row.document_id);return {ok:true,job:{id:row.id,document_id:row.document_id,expected_revision:row.expected_revision,command:JSON.parse(row.request_json),revision:d.revision,project:await snapshot(env,d)}};
  }
  if(op==='claim'){
    const owner=safeId(p.owner),now=Date.now();await env.DB.prepare('INSERT INTO quiz_executors(id,seen_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at').bind(owner,now).run();
    await env.DB.prepare(`UPDATE quiz_jobs SET status='FAILED',result_json=?,updated_at=? WHERE status IN ('RUNNING','CANCEL_REQUESTED') AND lease_until<?`).bind(json({ok:false,error:'EXECUTOR_LOST',retry:'Submit a new request_id after reviewing persisted revision.'}),now,now).run();
    const row:any=await env.DB.prepare(`UPDATE quiz_jobs SET status='RUNNING',owner=?,lease_until=?,updated_at=? WHERE id=(SELECT q.id FROM quiz_jobs q WHERE q.status='QUEUED' AND NOT EXISTS(SELECT 1 FROM quiz_jobs busy WHERE busy.document_id=q.document_id AND busy.status IN ('RUNNING','CANCEL_REQUESTED')) ORDER BY q.created_at,q.id LIMIT 1) AND status='QUEUED' RETURNING *`).bind(owner,now+60_000,now).first();
    if(!row)return {ok:true,job:null};const d=await doc(env,row.document_id);return {ok:true,job:{id:row.id,document_id:row.document_id,expected_revision:row.expected_revision,command:JSON.parse(row.request_json),revision:d.revision,project:await snapshot(env,d)}};
  }
  if(op==='heartbeat'){
    const now=Date.now();await env.DB.prepare('UPDATE quiz_executors SET seen_at=? WHERE id=?').bind(now,safeId(p.owner)).run();
    const r:any=await env.DB.prepare("UPDATE quiz_jobs SET lease_until=?,updated_at=? WHERE id=? AND owner=? AND status IN ('RUNNING','CANCEL_REQUESTED') AND lease_until>? RETURNING status").bind(now+60_000,now,safeId(p.job_id),safeId(p.owner),now).first();return {ok:!!r,cancel:!r||r.status==='CANCEL_REQUESTED'};
  }
  if(op==='complete'){
    const job:any=await env.DB.prepare("SELECT * FROM quiz_jobs WHERE id=? AND owner=? AND status IN ('RUNNING','CANCEL_REQUESTED') AND lease_until>?").bind(safeId(p.job_id),safeId(p.owner),Date.now()).first();if(!job)throw new QuizError('LEASE_LOST',409);
    const status=job.status==='CANCEL_REQUESTED'?'CANCELLED':p.result?.ok===false?'FAILED':'SUCCEEDED';
    // Snapshot + completion are one D1 transaction. A manual edit wins over a stale job.
    let key:string|null=null;const writes:any[]=[];const revision=Number(p.revision);
    if(status==='SUCCEEDED'&&p.project){
      if(!Array.isArray(p.project.scenes)||!p.project.scenes.length||p.project.scenes.length>1000||json(p.project).length>8_000_000)throw new QuizError('INVALID_PROJECT');
      key=`quiz/snapshots/${job.document_id}/${uuid()}.json`;await env.MEDIA.put(key,json(p.project),{httpMetadata:{contentType:'application/json'}});
      writes.push(env.DB.prepare(`UPDATE quiz_documents SET snapshot_key=?,summary_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM quiz_jobs WHERE id=? AND owner=? AND status='RUNNING' AND lease_until>?)`).bind(key,json(p.summary||{}),Date.now(),job.document_id,revision,job.id,p.owner,Date.now()));
    }
    const result={...p.result,revision:key?revision+1:revision};
    writes.push(env.DB.prepare(`UPDATE quiz_jobs SET status=CASE WHEN status='CANCEL_REQUESTED' THEN 'CANCELLED' WHEN ? IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quiz_documents WHERE id=? AND snapshot_key=?) THEN 'FAILED' ELSE ? END,result_json=CASE WHEN ? IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quiz_documents WHERE id=? AND snapshot_key=?) THEN ? ELSE ? END,updated_at=? WHERE id=? AND owner=? AND status IN ('RUNNING','CANCEL_REQUESTED') AND lease_until>?`).bind(key,job.document_id,key,status,key,job.document_id,key,json({ok:false,error:'REVISION_CONFLICT'}),json(result),Date.now(),job.id,p.owner,Date.now()));
    const out=await env.DB.batch(writes);if(key&&!out[0].meta.changes)await env.MEDIA.delete(key);return quizRpc(env,request,'job',{job_id:job.id});
  }
  throw new QuizError('UNKNOWN_OPERATION');
}
export async function uploadQuizMedia(env:Env,request:Request){
  await ensureQuiz(env);const mime=(request.headers.get('content-type')||'').split(';')[0];
  if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/mp4','application/json','text/plain','image/svg+xml'].includes(mime))throw new QuizError('UNSUPPORTED_MEDIA');
  const bytes=await request.arrayBuffer();if(bytes.byteLength>95_000_000)throw new QuizError('MEDIA_TOO_LARGE',413);
  const id=uuid(),key=`quiz/media/${id}`;await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime}});await env.DB.prepare('INSERT INTO quiz_media(id,r2_key,mime,size,created_at) VALUES(?,?,?,?,?)').bind(id,key,mime,bytes.byteLength,Date.now()).run();
  return {ok:true,id,url:`${new URL(request.url).origin}/quiz/media/${id}`,mime,size:bytes.byteLength};
}
export async function serveQuizMedia(env:Env,request:Request,id:string){
  await ensureQuiz(env);const row:any=await env.DB.prepare('SELECT * FROM quiz_media WHERE id=?').bind(safeId(id)).first();if(!row)return new Response('Not found',{status:404});
  const headers=new Headers({'content-type':row.mime,'content-length':String(row.size),'cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'accept-ranges':'bytes'});
  if(request.method==='HEAD')return new Response(null,{headers});
  let range: {offset:number;length:number}|undefined;const raw=request.headers.get('range');if(raw){const m=/^bytes=(\d*)-(\d*)$/.exec(raw);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416});const start=m[1]?Number(m[1]):Math.max(0,row.size-Number(m[2])),end=m[1]?(m[2]?Math.min(row.size-1,Number(m[2])):row.size-1):row.size-1;if(start>end||start>=row.size)return new Response(null,{status:416,headers:{'content-range':`bytes */${row.size}`}});range={offset:start,length:end-start+1};headers.set('content-range',`bytes ${start}-${end}/${row.size}`);headers.set('content-length',String(range.length));}
  const obj=await env.MEDIA.get(row.r2_key,range?{range}:undefined);return obj?new Response(obj.body,{status:range?206:200,headers}):new Response('Not found',{status:404});
}

export async function uploadQuizPart(env:Env,request:Request,id:string,part:number){
  await ensureQuiz(env);if(!Number.isInteger(part)||part<1||part>1000)throw new QuizError('INVALID_PART');
  const u:any=await env.DB.prepare('SELECT * FROM quiz_uploads WHERE id=?').bind(safeId(id)).first();if(!u)throw new QuizError('UPLOAD_NOT_FOUND',404);
  const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>8*1024*1024)throw new QuizError('INVALID_PART_SIZE');
  return {ok:true,...await env.MEDIA.resumeMultipartUpload(u.r2_key,u.upload_id).uploadPart(part,bytes)};
}

/** Restricts the browser bridge to the single leased job that launched it. */
export async function authorizeQuizExecutor(env:Env,request:Request){
  await ensureQuiz(env);const job=request.headers.get('x-quiz-job'),owner=request.headers.get('x-quiz-owner');
  if(!job||!owner)return false;
  const row=await env.DB.prepare("SELECT id FROM quiz_jobs WHERE id=? AND owner=? AND status IN ('RUNNING','CANCEL_REQUESTED') AND lease_until>?").bind(job,owner,Date.now()).first();
  return !!row;
}
