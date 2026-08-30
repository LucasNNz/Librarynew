import type { CorvoQueueJob, Env, PackageJob } from "../types";
import { createSignedPackageUrl, createSignedProjectMediaUrl, validSignedPackageRequest, validSignedProjectMediaRequest } from "./auth";
import { id, nowMs } from "./ids";
import { projectWriteGuard, updateProjectWorkflow } from "./project-workflow";
import { productionCompletionGate } from "./production-model";
import { reconcileAutomaticProject } from "./projects";

function clean(value: unknown) { return String(value ?? "").trim(); }
function parseJson<T>(value: unknown, fallback: T): T { try { return typeof value === "string" ? JSON.parse(value) as T : (value as T ?? fallback); } catch { return fallback; } }
function safeName(value: string) { return value.replace(/[\\/:*?"<>|\x00-\x1f]+/g,"-").replace(/\s+/g," ").trim().slice(0,160) || "arquivo"; }
function fileExt(mime:string){const m=mime.toLowerCase();if(m.includes("png"))return"png";if(m.includes("webp"))return"webp";if(m.includes("gif"))return"gif";if(m.includes("mp4"))return"mp4";if(m.includes("webm"))return"webm";if(m.includes("quicktime"))return"mov";return"jpg";}
function projectRevision(project:Record<string,unknown>){return Number(project.state_version||project.active_version||1);}
const RESOLVED_SLOT_STATES=new Set(["RESOLVED","FROZEN","APPROVED","COMPLETED"]);

const CRC_TABLE = (() => { const table=new Uint32Array(256); for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;} return table; })();
function crcUpdate(crc:number,chunk:Uint8Array){let c=crc;for(const b of chunk)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return c>>>0;}
function le16(v:number){const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,v,true);return b;}
function le32(v:number){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v>>>0,true);return b;}
function concat(parts:Uint8Array[]){const total=parts.reduce((n,p)=>n+p.byteLength,0),out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.byteLength;}return out;}
function dosDateTime(){const d=new Date();const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31);const date=(((d.getFullYear()-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);return{time,date};}

export type ZipEntry = {
  name:string;
  r2Key?:string;
  sizeBytes?:number;
  open:()=>Promise<ReadableStream<Uint8Array>|Uint8Array|null>;
};
type ResolvedZipEntry = ZipEntry & { sizeBytes:number };
type Central = {name:Uint8Array;crc:number;size:number;offset:number;time:number;date:number};
type FixedLengthStreamShape = {readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>};
type FixedLengthStreamConstructor = new(expectedLength:number)=>FixedLengthStreamShape;

function getFixedLengthStreamConstructor():FixedLengthStreamConstructor{
  const ctor=(globalThis as unknown as {FixedLengthStream?:FixedLengthStreamConstructor}).FixedLengthStream;
  if(!ctor)throw new Error("FIXED_LENGTH_STREAM_UNAVAILABLE");
  return ctor;
}

export async function resolveZipEntrySizes(env:Env,entries:ZipEntry[]):Promise<ResolvedZipEntry[]>{
  // R2 HEAD is authoritative. We intentionally resolve every unique object once before
  // opening the ZIP stream so the final request body can be wrapped in FixedLengthStream.
  // Repeated production slots pointing to the same AST share the same HEAD lookup.
  const r2Keys=[...new Set(entries.map(e=>clean(e.r2Key)).filter(Boolean))];
  const sizes=new Map<string,number>();
  await Promise.all(r2Keys.map(async key=>{
    const head=await env.MEDIA.head(key);
    if(!head)throw new Error(`R2_OBJECT_MISSING:${key}`);
    const size=Number(head.size);
    if(!Number.isSafeInteger(size)||size<0)throw new Error(`R2_OBJECT_SIZE_INVALID:${key}:${String(head.size)}`);
    sizes.set(key,size);
  }));
  return entries.map(entry=>{
    const size=entry.r2Key?sizes.get(clean(entry.r2Key)):Number(entry.sizeBytes);
    if(size===undefined||!Number.isSafeInteger(size)||size<0)throw new Error(`ZIP_ENTRY_SIZE_UNKNOWN:${entry.name}`);
    if(size>0xffffffff)throw new Error(`ZIP64_REQUIRED_ENTRY_TOO_LARGE:${entry.name}:${size}`);
    return {...entry,sizeBytes:size};
  });
}

export function zipExpectedSize(entries:ResolvedZipEntry[]){
  const encoder=new TextEncoder();let total=22; // end-of-central-directory
  for(const entry of entries){
    const nameLength=encoder.encode(entry.name).length;
    if(nameLength>0xffff)throw new Error(`ZIP_ENTRY_NAME_TOO_LONG:${entry.name}`);
    // local header 30 + name + payload + data descriptor 16 + central header 46 + name
    total+=92+(2*nameLength)+entry.sizeBytes;
    if(total>0xffffffff)throw new Error(`ZIP64_REQUIRED_ARCHIVE_TOO_LARGE:${total}`);
  }
  return total;
}

export function zipStream(entries:ResolvedZipEntry[]){
  const encoder=new TextEncoder();let totalBytes=0;
  const stream=new ReadableStream<Uint8Array>({start(controller){void(async()=>{try{
    const central:Central[]=[];
    for(const entry of entries){
      const name=encoder.encode(entry.name);const {time,date}=dosDateTime();const offset=totalBytes;
      const local=concat([le32(0x04034b50),le16(20),le16(0x0808),le16(0),le16(time),le16(date),le32(0),le32(0),le32(0),le16(name.length),le16(0),name]);
      controller.enqueue(local);totalBytes+=local.length;
      let crc=0xffffffff,size=0;const source=await entry.open();
      if(source instanceof Uint8Array){if(source.length){crc=crcUpdate(crc,source);size+=source.length;controller.enqueue(source);totalBytes+=source.length;}}
      else if(source){const reader=source.getReader();while(true){const {done,value}=await reader.read();if(done)break;if(value){crc=crcUpdate(crc,value);size+=value.length;controller.enqueue(value);totalBytes+=value.length;}}}
      if(size!==entry.sizeBytes)throw new Error(`ZIP_ENTRY_SIZE_MISMATCH:${entry.name}:expected=${entry.sizeBytes}:actual=${size}`);
      crc=(~crc)>>>0;const descriptor=concat([le32(0x08074b50),le32(crc),le32(size),le32(size)]);controller.enqueue(descriptor);totalBytes+=descriptor.length;central.push({name,crc,size,offset,time,date});
    }
    const centralOffset=totalBytes;const blocks:Uint8Array[]=[];
    for(const c of central){blocks.push(concat([le32(0x02014b50),le16(20),le16(20),le16(0x0808),le16(0),le16(c.time),le16(c.date),le32(c.crc),le32(c.size),le32(c.size),le16(c.name.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(c.offset),c.name]));}
    const centralDir=concat(blocks);controller.enqueue(centralDir);totalBytes+=centralDir.length;
    const end=concat([le32(0x06054b50),le16(0),le16(0),le16(central.length),le16(central.length),le32(centralDir.length),le32(centralOffset),le16(0)]);controller.enqueue(end);totalBytes+=end.length;controller.close();
  }catch(error){controller.error(error);}})();}});
  return{stream,getSize:()=>totalBytes};
}

export async function fixedLengthZipStream(env:Env,entries:ZipEntry[]){
  const resolved=await resolveZipEntrySizes(env,entries);const expectedSize=zipExpectedSize(resolved);const zipped=zipStream(resolved);
  const FixedLengthStreamCtor=getFixedLengthStreamConstructor();const fixed=new FixedLengthStreamCtor(expectedSize);
  const completion=zipped.stream.pipeTo(fixed.writable);
  return{stream:fixed.readable,expectedSize,completion,getSize:()=>zipped.getSize()};
}

function zipInfrastructureFailure(message:string){
  return /known length|FixedLengthStream|FIXED_LENGTH_STREAM|ZIP_ENTRY_SIZE_MISMATCH|ZIP_R2_SIZE_MISMATCH/i.test(message);
}

async function projectBundleEntries(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)throw new Error("PROJECT_NOT_FOUND");
  const [filesResult,itemsResult,productionSlotsResult,mediaResult,titlesResult]=await Promise.all([
    env.DB.prepare("SELECT * FROM automatic_project_files WHERE project_id=? ORDER BY role,version DESC,created_at DESC").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT i.*,a.name AS asset_name,a.r2_key,a.original_name,a.mime_type,a.size_bytes FROM automatic_project_items i LEFT JOIN assets a ON a.id=i.linked_asset_id WHERE i.project_id=? AND i.version=? AND i.linked_asset_id IS NOT NULL AND upper(i.status) IN ('FROZEN','APROVADO','APPROVED','CONCLUIDO','CONCLUÍDO') ORDER BY i.priority ASC,i.created_at ASC`).bind(projectId,Number(project.active_version||1)).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT s.*,a.name AS asset_name,a.r2_key,a.original_name,a.mime_type,a.size_bytes FROM v2_production_slots s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=? AND s.version=? ORDER BY COALESCE((SELECT scene_number FROM v2_production_scenes sc WHERE sc.id=s.scene_id),999999),s.slot_index,s.created_at`).bind(projectId,Number(project.active_version||1)).all<Record<string,unknown>>().catch(()=>({results:[]} as unknown as D1Result<Record<string,unknown>>)),
    env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? AND status NOT IN ('REJECTED','THUMB_REJECTED') ORDER BY selected DESC,created_at ASC").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT * FROM v2_project_titles WHERE project_id=? AND status NOT IN ('REJECTED','TITLE_REJECTED') ORDER BY selected DESC,created_at ASC").bind(projectId).all<Record<string,unknown>>(),
  ]);
  const latestByRole=new Map<string,Record<string,unknown>>();for(const f of filesResult.results||[]){const role=clean(f.role).toUpperCase();if(!latestByRole.has(role))latestByRole.set(role,f);}
  const entries:ZipEntry[]=[];const used=new Set<string>();const unique=(name:string)=>{let n=safeName(name);if(!used.has(n)){used.add(n);return n;}const dot=n.lastIndexOf("."),stem=dot>0?n.slice(0,dot):n,ext=dot>0?n.slice(dot):"";let i=2;while(used.has(`${stem}-${i}${ext}`))i++;n=`${stem}-${i}${ext}`;used.add(n);return n;};
  const addR2=(name:string,key:string,sizeBytes?:number)=>entries.push({name:unique(name),r2Key:key,sizeBytes,open:async()=>{const obj=await env.MEDIA.get(key);if(!obj)throw new Error(`R2_OBJECT_MISSING:${key}`);return obj.body;}});
  const addText=(name:string,text:string)=>{const bytes=new TextEncoder().encode(text);entries.push({name:unique(name),sizeBytes:bytes.length,open:async()=>bytes});};
  const script=["SCRIPT","ROTEIRO"].map(k=>latestByRole.get(k)).find(Boolean);const req=["REQUIREMENTS","IMAGENS_NECESSARIAS","IMAGENS NECESSARIAS"].map(k=>latestByRole.get(k)).find(Boolean);
  if(script)addR2("ROTEIRO.txt",clean(script.r2_key),Number(script.size_bytes||0));else addText("ROTEIRO.txt","ROTEIRO NÃO ANEXADO\n");
  if(req)addR2("IMAGENS_NECESSARIAS.txt",clean(req.r2_key),Number(req.size_bytes||0));else addText("IMAGENS_NECESSARIAS.txt","IMAGENS NECESSÁRIAS NÃO ANEXADAS\n");
  for(const f of filesResult.results||[]){if(f===script||f===req)continue;addR2(`ARQUIVOS/${safeName(clean(f.file_name)||`${clean(f.role)}-${f.version}`)}`,clean(f.r2_key),Number(f.size_bytes||0));}
  const productionSlots=productionSlotsResult.results||[];
  const imageRows=productionSlots.length?productionSlots:(itemsResult.results||[]);
  if(productionSlots.length){
    const unresolved=productionSlots.filter(slot=>!clean(slot.asset_id)||!RESOLVED_SLOT_STATES.has(clean(slot.status).toUpperCase())||!clean(slot.target_file));
    if(unresolved.length)throw new Error(`PRODUCTION_SLOTS_INCOMPLETE:${unresolved.length}`);
  }
  for(const item of imageRows){const key=clean(item.r2_key);if(!key)continue;const base=clean(item.target_file)||clean(item.original_name)||`${clean(item.item_key)||clean(item.id)}.${fileExt(clean(item.mime_type))}`;addR2(`IMAGENS/${safeName(base)}`,key,Number(item.size_bytes||0));}
  for(const media of mediaResult.results||[]){const prefix=Number(media.selected||0)?"SELECIONADA-":"";addR2(`THUMBS/${prefix}${safeName(clean(media.name)||`${clean(media.id)}.${fileExt(clean(media.mime_type))}`)}`,clean(media.r2_key),Number(media.size_bytes||0));}
  const titles= titlesResult.results||[];const selected=titles.find(t=>Number(t.selected||0)===1);addText("TITULOS.txt",["TÍTULO SELECIONADO:",selected?clean(selected.text):"Nenhum título selecionado.","","IDEIAS ATIVAS:",...titles.map((t,i)=>`${i+1}. ${clean(t.text)}${Number(t.selected||0)?" [SELECIONADO]":""}`),""].join("\n"));
  addText("PROJETO.json",JSON.stringify({project_id:projectId,name:project.name,status:project.status,active_version:project.active_version,state_version:project.state_version,production_manifest:productionSlots.length>0,production_slots:productionSlots.length,images:imageRows.length,thumbs:(mediaResult.results||[]).length,titles:titles.length,generated_at:new Date().toISOString()},null,2));
  return{project,entries,imageCount:imageRows.length,thumbCount:(mediaResult.results||[]).length,titleCount:titles.length,productionSlotCount:productionSlots.length};
}

export async function queueFinalPackage(env:Env,input:{projectId:string;type?:string;operationId?:string}){
  const guard=await projectWriteGuard(env,input.projectId);if(!guard.ok)return guard;const project=guard.project as Record<string,unknown>;
  const production=await productionCompletionGate(env,input.projectId).catch(()=>null);
  if(Number(production?.production_slots_total||0)>0&&Number(production?.production_slots_resolved||0)<Number(production?.production_slots_total||0))return{error:"PRODUCTION_SLOTS_INCOMPLETE",status:409,...production}as const;
  await updateProjectWorkflow(env,{projectId:input.projectId,activate:["DOWNLOADER_WORKING"],ownerId:"MCP_DOWNLOADER",executionId:clean(input.operationId)||`download-${nowMs()}`,ttlSeconds:600,metadata:{source:"queue_final_package"}}).catch(()=>undefined);
  const type=(input.type||"PROJECT_PRODUCTION_ZIP").toUpperCase();if(!["FULL_PROJECT_ZIP","PROJECT_PRODUCTION_ZIP"].includes(type))return{error:"PACKAGE_TYPE_NOT_SUPPORTED",status:400}as const;const revision=projectRevision(project),operationId=clean(input.operationId)||id("OP");
  const byOp=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE operation_id=?").bind(operationId).first<Record<string,unknown>>();if(byOp)return{...byOp,reused:true,httpStatus:202}as const;
  const existing=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE project_id=? AND project_revision=? AND type=? AND status NOT IN ('FAILED') ORDER BY created_at DESC LIMIT 1").bind(input.projectId,revision,type).first<Record<string,unknown>>();if(existing)return{...existing,reused:true,httpStatus:202}as const;
  const packageId=id("PKG"),jobId=id("JOB"),ts=nowMs();await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_download_packages (id,operation_id,project_id,project_revision,type,status,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',?,?)").bind(packageId,operationId,input.projectId,revision,type,ts,ts),
    env.DB.prepare("INSERT INTO v2_ingest_operations (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at) VALUES (?,'GENERATE_PACKAGE','QUEUED',1,0,0,?,?,?)").bind(operationId,JSON.stringify({packageId,projectId:input.projectId,revision}),ts,ts),
    env.DB.prepare("INSERT INTO v2_control_jobs (id,operation_id,kind,project_id,status,payload_json,created_at,updated_at) VALUES (?,?,'GENERATE_PACKAGE',?,'QUEUED',?,?,?)").bind(jobId,operationId,input.projectId,JSON.stringify({packageId,revision}),ts,ts),
  ]);await env.MATERIALIZE_QUEUE.send({kind:"GENERATE_PACKAGE",operationId,packageId,projectId:input.projectId} satisfies CorvoQueueJob);return{package_id:packageId,operation_id:operationId,project_id:input.projectId,project_revision:revision,type,status:"QUEUED",reused:false,httpStatus:202}as const;
}

export async function processPackageJob(env:Env,job:PackageJob){
  const ts=nowMs();
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_download_packages SET status='PROCESSING',error=NULL,updated_at=? WHERE id=?").bind(ts,job.packageId),
    env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=?").bind(ts,job.operationId),
    env.DB.prepare("UPDATE v2_control_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(ts,job.operationId),
  ]);
  try{
    const bundle=await projectBundleEntries(env,job.projectId);const revision=projectRevision(bundle.project);
    const fileName=`${safeName(clean(bundle.project.name)||job.projectId).replace(/\s+/g,"_").toUpperCase()}_PRODUCAO.zip`;
    const r2Key=`projects/${job.projectId}/production/exports/r${revision}-${Date.now()}-${fileName}`;
    const zipped=await fixedLengthZipStream(env,bundle.entries);
    const put=env.MEDIA.put(r2Key,zipped.stream,{httpMetadata:{contentType:"application/zip",contentDisposition:`attachment; filename=\"${fileName.replace(/[\"\\\r\n]/g,"-")}\"`},customMetadata:{projectId:job.projectId,revision:String(revision),packageId:job.packageId,knownLength:String(zipped.expectedSize)}});
    await Promise.all([put,zipped.completion]);
    const head=await env.MEDIA.head(r2Key);const actualSize=Number(head?.size||0);
    if(!head||actualSize!==zipped.expectedSize)throw new Error(`ZIP_R2_SIZE_MISMATCH:expected=${zipped.expectedSize}:actual=${actualSize}`);
    const done=nowMs();
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_download_packages SET status='READY_FOR_DOWNLOAD',r2_key=?,file_name=?,size_bytes=?,ready_at=?,updated_at=?,error=NULL WHERE id=?").bind(r2Key,fileName,actualSize,done,done,job.packageId),
      env.DB.prepare("UPDATE automatic_projects SET zip_r2_key=?,zip_file_name=?,zip_size_bytes=?,state_version=state_version+1,updated_at=? WHERE id=?").bind(r2Key,fileName,actualSize,done,job.projectId),
      env.DB.prepare("UPDATE v2_ingest_operations SET status='COMPLETED',succeeded=1,failed=0,updated_at=? WHERE id=?").bind(done,job.operationId),
      env.DB.prepare("UPDATE v2_control_jobs SET status='COMPLETED',result_json=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(JSON.stringify({packageId:job.packageId,r2Key,fileName,sizeBytes:actualSize,expectedSize:zipped.expectedSize,images:bundle.imageCount,thumbs:bundle.thumbCount,titles:bundle.titleCount,productionSlots:bundle.productionSlotCount,fixedLengthStream:true}),done,done,job.operationId),
      env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),job.projectId,"PACKAGE_EXPORT_READY","READY_FOR_DOWNLOAD",JSON.stringify({packageId:job.packageId,r2Key,fileName,sizeBytes:actualSize,fixedLengthStream:true}),done),
    ]);
    await updateProjectWorkflow(env,{projectId:job.projectId,activate:["DOWNLOADER_COMPLETED"],clear:["DOWNLOADER_WORKING"],metadata:{packageId:job.packageId,fixedLengthStream:true}}).catch(()=>undefined);
    await reconcileAutomaticProject(env,job.projectId).catch(()=>undefined);
    return{packageId:job.packageId,status:"READY_FOR_DOWNLOAD",r2Key,fileName,sizeBytes:actualSize,fixedLengthStream:true};
  }catch(error){
    const message=error instanceof Error?error.message:String(error),done=nowMs(),infra=zipInfrastructureFailure(message);
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_download_packages SET status='FAILED',error=?,updated_at=? WHERE id=?").bind(message,done,job.packageId),
      env.DB.prepare("UPDATE v2_ingest_operations SET status='FAILED',failed=1,error=?,updated_at=? WHERE id=?").bind(message,done,job.operationId),
      env.DB.prepare("UPDATE v2_control_jobs SET status='FAILED',error=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(message,done,done,job.operationId),
      env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),job.projectId,infra?"PACKAGE_EXPORT_BLOCKED":"PACKAGE_EXPORT_FAILED",infra?"PACKAGE_BLOCKED_INFRASTRUCTURE":"FAILED",JSON.stringify({packageId:job.packageId,error:message,nextAction:infra?"CORRIGIR_EXPORTADOR_ZIP_FIXED_LENGTH_STREAM":"REVIEW_PACKAGE_FAILURE"}),done),
    ]);
    await updateProjectWorkflow(env,{projectId:job.projectId,clear:["DOWNLOADER_WORKING"],metadata:{packageId:job.packageId,error:message,infra}}).catch(()=>undefined);
    if(infra){
      await env.DB.prepare("UPDATE automatic_projects SET status='PACKAGE_BLOCKED_INFRASTRUCTURE',pipeline_status='PACKAGE_BLOCKED_INFRASTRUCTURE',next_action='CORRIGIR_EXPORTADOR_ZIP_FIXED_LENGTH_STREAM',state_version=state_version+1,updated_at=? WHERE id=?").bind(done,job.projectId).run().catch(()=>undefined);
    }
    throw error;
  }
}

export async function listReadyPackages(env:Env,input:{projectId?:string;status?:string;limit?:number}={}){const where:string[]=[];const values:unknown[]=[];if(input.projectId){where.push("p.project_id=?");values.push(input.projectId)}if(input.status&&input.status!=="ALL"){where.push("p.status=?");values.push(input.status)}else if(!input.status)where.push("p.status='READY_FOR_DOWNLOAD'");values.push(Math.max(1,Math.min(input.limit||100,200)));const rows=await env.DB.prepare(`SELECT p.*,a.name AS project_name FROM v2_download_packages p LEFT JOIN automatic_projects a ON a.id=p.project_id ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY p.created_at DESC LIMIT ?`).bind(...values).all<Record<string,unknown>>();return{total:(rows.results||[]).length,packages:rows.results||[]};}
export async function getPackageLink(request:Request,env:Env,packageId:string,ttlMinutes=30){const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row)return{error:"PACKAGE_NOT_FOUND",status:404}as const;if(!["READY_FOR_DOWNLOAD","DOWNLOADED"].includes(clean(row.status)))return{error:`PACKAGE_NOT_READY:${clean(row.status)}`,status:409}as const;const ttl=Math.max(1,Math.min(ttlMinutes,60))*60;return{package_id:packageId,project_id:row.project_id,status:row.status,download_url:await createSignedPackageUrl(request,packageId,env,ttl),expires_at:new Date(Date.now()+ttl*1000).toISOString(),filename:row.file_name,size_bytes:Number(row.size_bytes||0),sha256:row.sha256||null,direct_to_pc:true,chat_file_delivery:"DISABLED",httpStatus:200}as const;}
export async function servePackageFile(request:Request,packageId:string,env:Env){if(!(await validSignedPackageRequest(request,packageId,env)))return new Response("Forbidden",{status:403});const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row?.r2_key)return new Response("Not found",{status:404});const obj=await env.MEDIA.get(clean(row.r2_key));if(!obj)return new Response("Not found",{status:404});return new Response(obj.body,{headers:{"content-type":"application/zip","content-disposition":`attachment; filename=\"${safeName(clean(row.file_name)||`${packageId}.zip`)}\"`,"cache-control":"private, max-age=60"}});}
export async function confirmPackageDownload(env:Env,packageId:string,input:{machineName?:string;sha256?:string}){const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row)return{error:"PACKAGE_NOT_FOUND",status:404}as const;const guard=await projectWriteGuard(env,clean(row.project_id));if(!guard.ok)return guard;const supplied=clean(input.sha256).toLowerCase(),expected=clean(row.sha256).toLowerCase();const verified=expected&&supplied?Number(expected===supplied):null;const ts=nowMs();await env.DB.prepare("UPDATE v2_download_packages SET status='DOWNLOADED',download_count=download_count+1,machine_name=?,sha256_verified=?,downloaded_at=?,updated_at=? WHERE id=?").bind(input.machineName||null,verified,ts,ts,packageId).run();const projectId=clean(row.project_id);if(projectId)await updateProjectWorkflow(env,{projectId,activate:["DOWNLOADER_COMPLETED"],clear:["DOWNLOADER_WORKING"],metadata:{packageId}}).catch(()=>undefined);return{package_id:packageId,status:"DOWNLOADED",sha256_verified:verified===null?null:Boolean(verified),downloaded_at:new Date(ts).toISOString()};}

export async function projectProductionPackage(request:Request,env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)return null;
  const version=Number(project.active_version||1);
  const [items,productionSlots,productionScenes,referencePools,media,titles,files,packages]=await Promise.all([
    env.DB.prepare("SELECT id,item_key,target_file,status,linked_asset_id FROM automatic_project_items WHERE project_id=? AND version=? ORDER BY priority,created_at").bind(projectId,version).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT s.*,a.name asset_name,a.r2_key asset_r2_key,a.mime_type asset_mime_type FROM v2_production_slots s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=? AND s.version=? ORDER BY s.created_at`).bind(projectId,version).all<Record<string,unknown>>().catch(()=>({results:[]} as unknown as D1Result<Record<string,unknown>>)),
    env.DB.prepare("SELECT * FROM v2_production_scenes WHERE project_id=? AND version=? ORDER BY scene_number,created_at").bind(projectId,version).all<Record<string,unknown>>().catch(()=>({results:[]} as unknown as D1Result<Record<string,unknown>>)),
    env.DB.prepare("SELECT * FROM v2_reference_pools WHERE project_id=? AND version=? ORDER BY pool_key").bind(projectId,version).all<Record<string,unknown>>().catch(()=>({results:[]} as unknown as D1Result<Record<string,unknown>>)),
    env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? ORDER BY selected DESC,created_at").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT * FROM v2_project_titles WHERE project_id=? ORDER BY selected DESC,created_at").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,role,version,file_name,mime_type,size_bytes,created_at FROM automatic_project_files WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT * FROM v2_download_packages WHERE project_id=? ORDER BY created_at DESC LIMIT 10").bind(projectId).all<Record<string,unknown>>(),
  ]);
  const mediaRows=media.results||[];
  const slots=productionSlots.results||[];
  const resolved=slots.filter(s=>clean(s.asset_id)&&RESOLVED_SLOT_STATES.has(clean(s.status).toUpperCase())).length;
  return{project,items:items.results||[],production:{reference_pools:referencePools.results||[],production_scenes:productionScenes.results||[],production_slots:slots,production_slots_total:slots.length,production_slots_resolved:resolved},files:files.results||[],thumbs:await Promise.all(mediaRows.map(async m=>({...m,preview_url:await createSignedProjectMediaUrl(request,clean(m.id),env,900)}))),titles:titles.results||[],packages:packages.results||[],selected_thumb:mediaRows.find(m=>Number(m.selected||0))||null,selected_title:(titles.results||[]).find(t=>Number(t.selected||0))||null};
}

export async function projectThumbLinks(request:Request,env:Env,projectId:string,limit=50){const rows=await env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? AND kind='THUMB' ORDER BY selected DESC,created_at DESC LIMIT ?").bind(projectId,Math.max(1,Math.min(limit,100))).all<Record<string,unknown>>();return{items:await Promise.all((rows.results||[]).map(async r=>({...r,preview_url:await createSignedProjectMediaUrl(request,clean(r.id),env,900)})))};}
export async function serveProjectMedia(request:Request,mediaId:string,env:Env){if(!(await validSignedProjectMediaRequest(request,mediaId,env)))return new Response("Forbidden",{status:403});const row=await env.DB.prepare("SELECT * FROM v2_project_media WHERE id=?").bind(mediaId).first<Record<string,unknown>>();if(!row)return new Response("Not found",{status:404});const obj=await env.MEDIA.get(clean(row.r2_key));if(!obj)return new Response("Not found",{status:404});const download=new URL(request.url).searchParams.get("mode")==="download";return new Response(obj.body,{headers:{"content-type":clean(row.mime_type)||"application/octet-stream","content-disposition":download?`attachment; filename="${safeName(clean(row.name)||mediaId)}"`:`inline; filename="${safeName(clean(row.name)||mediaId)}"`,"cache-control":"private, max-age=60","x-content-type-options":"nosniff"}});}
export async function decideProjectThumbs(env:Env,projectId:string,decisions:Array<{mediaId:string;action:string;reason?:string}>){const guard=await projectWriteGuard(env,projectId);if(!guard.ok)return guard;const results:unknown[]=[];for(const d of decisions.slice(0,100)){const action=clean(d.action).toUpperCase(),ts=nowMs();const row=await env.DB.prepare("SELECT * FROM v2_project_media WHERE id=? AND project_id=? AND kind='THUMB'").bind(d.mediaId,projectId).first<Record<string,unknown>>();if(!row){results.push({mediaId:d.mediaId,error:"NOT_FOUND"});continue;}if(action==="SELECT"){await env.DB.batch([env.DB.prepare("UPDATE v2_project_media SET selected=0,updated_at=? WHERE project_id=? AND kind='THUMB'").bind(ts,projectId),env.DB.prepare("UPDATE v2_project_media SET selected=1,status='THUMB_APPROVED',metadata_json=json_set(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.decisionReason',?),updated_at=? WHERE id=?").bind(d.reason||null,ts,d.mediaId)]);}else if(action==="APPROVE")await env.DB.prepare("UPDATE v2_project_media SET status='THUMB_APPROVED',updated_at=? WHERE id=?").bind(ts,d.mediaId).run();else if(action==="REJECT")await env.DB.prepare("UPDATE v2_project_media SET status='THUMB_REJECTED',selected=0,slot_index=NULL,updated_at=? WHERE id=?").bind(ts,d.mediaId).run();else{results.push({mediaId:d.mediaId,error:"INVALID_ACTION"});continue;}results.push({mediaId:d.mediaId,action,ok:true});}return{results};}
export async function pushProjectTitles(env:Env,projectId:string,titles:Array<{text:string;agentOrigin?:string}>){
  const guard=await projectWriteGuard(env,projectId);if(!guard.ok)return guard;
  const ts=nowMs(),rows=[] as Record<string,unknown>[];
  await updateProjectWorkflow(env,{projectId,activate:["TITLES_WORKING"],ownerId:"MCP_TITLES",executionId:`titles-${ts}`,ttlSeconds:300}).catch(()=>undefined);
  for(const title of titles.slice(0,100)){
    const text=clean(title.text);if(!text)continue;
    const duplicate=await env.DB.prepare("SELECT * FROM v2_project_titles WHERE project_id=? AND text=? AND status NOT IN ('TITLE_REJECTED','REJECTED') LIMIT 1").bind(projectId,text).first<Record<string,unknown>>();if(duplicate){rows.push({...duplicate,idempotent:true});continue;}
    const slots=await env.DB.prepare("SELECT slot_index FROM v2_project_titles WHERE project_id=? AND slot_index IS NOT NULL AND status NOT IN ('TITLE_REJECTED','REJECTED') ORDER BY slot_index").bind(projectId).all<{slot_index:number}>();
    const used=new Set((slots.results||[]).map(r=>Number(r.slot_index)));let slotIndex=0;for(let i=1;i<=3;i++)if(!used.has(i)){slotIndex=i;break;}if(!slotIndex)break;
    const titleId=id("TITLE");const insert=await env.DB.prepare("INSERT OR IGNORE INTO v2_project_titles (id,project_id,text,status,selected,agent_origin,slot_index,created_at,updated_at) VALUES (?,?,?,'TITLE_CANDIDATE',0,?,?,?,?)").bind(titleId,projectId,text,title.agentOrigin||null,slotIndex,ts,ts).run();
    if(Number(insert.meta?.changes||0)>0)rows.push({id:titleId,text,status:"TITLE_CANDIDATE",slot_index:slotIndex});
  }
  if(rows.length)await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,projectId).run();
  return{project_id:projectId,created:rows.filter(r=>!r.idempotent).length,total:rows.length,max:3,titles:rows};
}

export async function decideProjectTitles(env:Env,projectId:string,decisions:Array<{titleId:string;action:string}>){
  const guard=await projectWriteGuard(env,projectId);if(!guard.ok)return guard;
  const results=[] as Record<string,unknown>[];
  for(const d of decisions.slice(0,100)){const action=clean(d.action).toUpperCase(),ts=nowMs();if(action==="SELECT")await env.DB.batch([env.DB.prepare("UPDATE v2_project_titles SET selected=0,updated_at=? WHERE project_id=?").bind(ts,projectId),env.DB.prepare("UPDATE v2_project_titles SET selected=1,status='TITLE_APPROVED',updated_at=? WHERE id=? AND project_id=?").bind(ts,d.titleId,projectId)]);else if(action==="APPROVE")await env.DB.prepare("UPDATE v2_project_titles SET status='TITLE_APPROVED',updated_at=? WHERE id=? AND project_id=?").bind(ts,d.titleId,projectId).run();else if(action==="REJECT")await env.DB.prepare("UPDATE v2_project_titles SET status='TITLE_REJECTED',selected=0,slot_index=NULL,updated_at=? WHERE id=? AND project_id=?").bind(ts,d.titleId,projectId).run();else{results.push({titleId:d.titleId,error:"INVALID_ACTION"});continue;}results.push({titleId:d.titleId,action,ok:true});}
  return{results};
}


export async function createProjectMediaFromCandidate(env:Env,input:{candidateId:string;projectId:string;r2Key:string;mimeType:string;sizeBytes:number;sourceUrl?:string;name?:string;agentOrigin?:string}){
  const existing=await env.DB.prepare("SELECT * FROM v2_project_media WHERE metadata_json LIKE ? AND project_id=? AND kind='THUMB' LIMIT 1").bind(`%${input.candidateId}%`,input.projectId).first<Record<string,unknown>>();if(existing)return existing;
  const guard=await projectWriteGuard(env,input.projectId);if(!guard.ok)return guard;
  const slots=await env.DB.prepare("SELECT slot_index FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND slot_index IS NOT NULL AND status NOT IN ('THUMB_REJECTED','REJECTED') ORDER BY slot_index").bind(input.projectId).all<{slot_index:number}>();
  const used=new Set((slots.results||[]).map(r=>Number(r.slot_index)));let slotIndex=0;for(let i=1;i<=3;i++)if(!used.has(i)){slotIndex=i;break;}if(!slotIndex)return{error:"THUMB_SLOTS_FULL",projectId:input.projectId,max:3,status:409} as const;
  const mediaId=id("PMEDIA"),ts=nowMs();const orientation=String(input.mimeType||"").startsWith("image/")?null:null;
  await env.DB.prepare("INSERT OR IGNORE INTO v2_project_media (id,project_id,kind,status,name,r2_key,mime_type,size_bytes,source_url,agent_origin,selected,metadata_json,slot_index,orientation,created_at,updated_at) VALUES (?,?,'THUMB','THUMB_CANDIDATE',?,?,?,?,?,?,0,?,?,?,?,?,?)").bind(mediaId,input.projectId,input.name||`${mediaId}.${fileExt(input.mimeType)}`,input.r2Key,input.mimeType,input.sizeBytes,input.sourceUrl||null,input.agentOrigin||null,JSON.stringify({candidateId:input.candidateId}),slotIndex,orientation,ts,ts).run();
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId).run().catch(()=>undefined);
  return env.DB.prepare("SELECT * FROM v2_project_media WHERE id=?").bind(mediaId).first<Record<string,unknown>>();
}

