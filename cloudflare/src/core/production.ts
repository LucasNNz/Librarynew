import type { CorvoQueueJob, Env, PackageJob } from "../types";
import { createSignedPackageUrl, createSignedProjectMediaUrl, validSignedPackageRequest, validSignedProjectMediaRequest } from "./auth";
import { id, nowMs, stableId } from "./ids";
import { projectWriteGuard, updateProjectWorkflow } from "./project-workflow";
import { materializeProductionModel, productionCompletionGate, type ProductionSceneSeed } from "./production-model";
import { reconcileAutomaticProject } from "./projects";
import { parseProjectScriptScenes } from "./project-script-parser";

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
type DigestStreamShape = WritableStream<Uint8Array> & {digest:Promise<ArrayBuffer>};
type DigestStreamConstructor = new(algorithm:string)=>DigestStreamShape;

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
  const DigestStreamCtor=(crypto as unknown as {DigestStream?:DigestStreamConstructor}).DigestStream;
  if(!DigestStreamCtor)throw new Error("DIGEST_STREAM_UNAVAILABLE");
  const digestStream=new DigestStreamCtor("SHA-256");
  const [r2Branch,hashBranch]=zipped.stream.tee();
  const completion=r2Branch.pipeTo(fixed.writable);
  const hashCompletion=hashBranch.pipeTo(digestStream);
  const sha256=(async()=>{await hashCompletion;const digest=await digestStream.digest;return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");})();
  return{stream:fixed.readable,expectedSize,completion,sha256,getSize:()=>zipped.getSize()};
}

function zipInfrastructureFailure(message:string){
  return /known length|FixedLengthStream|FIXED_LENGTH_STREAM|ZIP_ENTRY_SIZE_MISMATCH|ZIP_R2_SIZE_MISMATCH|pipeTo.*WritableStream/i.test(message);
}

async function projectExportGuard(env:Env,projectId:string){
  // Export is deliberately allowed for a completed/locked project because it consumes
  // already-persisted production state. Rejected/cancelled projects stay blocked.
  const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return {ok:false,error:"PROJECT_NOT_FOUND",status:404} as const;
  const lifecycle=clean(project.lifecycle_status).toUpperCase(),status=clean(project.status).toUpperCase();
  if(["REJECTED","CANCELLED","CANCELED"].includes(lifecycle)||["REJECTED","CANCELLED","CANCELED"].includes(status))return {ok:false,error:"PROJECT_EXPORT_BLOCKED",lifecycleStatus:project.lifecycle_status||project.status,status:409} as const;
  return {ok:true,project,status:200} as const;
}

export type FinalArtifactType = "PROJECT_IMAGES_ZIP"|"PROJECT_SCRIPT_TXT"|"PROJECT_PUBLICATION_ZIP";
const FINAL_ARTIFACT_TYPES = new Set<FinalArtifactType>(["PROJECT_IMAGES_ZIP","PROJECT_SCRIPT_TXT","PROJECT_PUBLICATION_ZIP"]);

function normalizeTarget(value:string){return safeName(clean(value)).toLowerCase();}
function extOf(value:string){const m=clean(value).toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:"";}
function expectedMimeForTarget(value:string){const ext=extOf(value);if(ext==="jpg"||ext==="jpeg")return"image/jpeg";if(ext==="png")return"image/png";if(ext==="webp")return"image/webp";return"";}
function formatLabelForMime(mime:string){if(mime==="image/jpeg")return"jpg";if(mime==="image/png")return"png";if(mime==="image/webp")return"webp";return"";}
function mimeForArtifactType(type:string){if(type==="PROJECT_SCRIPT_TXT")return"text/plain; charset=utf-8";return"application/zip";}
function filenameForArtifactType(type:string){if(type==="PROJECT_IMAGES_ZIP")return"imagens.zip";if(type==="PROJECT_SCRIPT_TXT")return"roteiro.txt";if(type==="PROJECT_PUBLICATION_ZIP")return"thumbs_titulos.zip";return"projeto.zip";}
async function sha256Hex(value:Uint8Array|string){const bytes=typeof value==="string"?new TextEncoder().encode(value):value;const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}

async function mapLimit<T,R>(items:T[],limit:number,worker:(item:T,index:number)=>Promise<R>):Promise<R[]>{
  const output=new Array<R>(items.length);let cursor=0;const width=Math.max(1,Math.min(limit,items.length||1));
  await Promise.all(Array.from({length:width},async()=>{while(true){const index=cursor++;if(index>=items.length)return;output[index]=await worker(items[index],index);}}));
  return output;
}

async function activeScript(env:Env,projectId:string){
  const row=await env.DB.prepare("SELECT * FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>();
  if(!row?.r2_key)throw new Error("SCRIPT_NOT_READY");
  const obj=await env.MEDIA.get(clean(row.r2_key));if(!obj)throw new Error(`SCRIPT_R2_MISSING:${clean(row.r2_key)}`);
  const bytes=new Uint8Array(await obj.arrayBuffer());
  let text="";try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Error("SCRIPT_NOT_UTF8");}
  return{row,bytes,text,hash:clean(row.content_hash)||await sha256Hex(bytes)};
}

function scriptImageRefs(text:string){
  const refs:string[]=[];const seen=new Set<string>();
  const field=/^\s*(?:[-*+]\s*)?(?:IMAGEM(?:_[A-Z0-9]+|[0-9]+)?|IMAGEM\s+[A-Z0-9]+|IMAGE(?:_[A-Z0-9]+|[0-9]+)?)\s*[:=-]\s*(.+)$/gim;
  const file=/\b([A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:jpe?g|png|webp|gif|avif))\b/gi;
  for(const match of text.matchAll(field))for(const f of String(match[1]||"").matchAll(file)){const name=safeName(clean(f[1]));const key=name.toLowerCase();if(name&&!seen.has(key)){seen.add(key);refs.push(name);}}
  return refs;
}

async function sniffR2ImageMime(env:Env,key:string){
  const obj=await (env.MEDIA as unknown as {get:(key:string,opts?:unknown)=>Promise<R2ObjectBody|null>}).get(key,{range:{offset:0,length:32}});if(!obj)return"";
  const b=new Uint8Array(await obj.arrayBuffer());
  if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return"image/jpeg";
  if(b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)return"image/png";
  if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP")return"image/webp";
  if(b.length>=6&&String.fromCharCode(...b.slice(0,6)).startsWith("GIF8"))return"image/gif";
  if(b.length>=12&&String.fromCharCode(...b.slice(4,12)).includes("ftypavif"))return"image/avif";
  return"";
}

async function ensureImageTargetFormat(env:Env,input:{projectId:string;assetId:string;r2Key:string;targetFile:string;sourceMime?:string;assetHash?:string}){
  const wanted=expectedMimeForTarget(input.targetFile);if(!wanted)throw new Error(`UNSUPPORTED_TARGET_FORMAT:${input.targetFile}`);
  const actual=await sniffR2ImageMime(env,input.r2Key);if(actual===wanted){const head=await env.MEDIA.head(input.r2Key);if(!head)throw new Error(`R2_OBJECT_MISSING:${input.r2Key}`);return{r2Key:input.r2Key,sizeBytes:Number(head.size),mime:wanted,converted:false};}
  const images=(env as Env & {IMAGES?:any}).IMAGES;
  if(!images?.input)throw new Error(`IMAGE_FORMAT_CONVERSION_REQUIRED:${input.targetFile}:actual=${actual||clean(input.sourceMime)||"unknown"}:expected=${wanted}:IMAGES_BINDING_REQUIRED`);
  const source=await env.MEDIA.get(input.r2Key);if(!source)throw new Error(`R2_OBJECT_MISSING:${input.r2Key}`);
  let pipeline=images.input(source.body);
  if(typeof pipeline.transform==="function")pipeline=pipeline.transform({});
  const output=await pipeline.output({format:wanted});
  const response=typeof output?.response==="function"?output.response():output;
  if(!response||typeof response.arrayBuffer!=="function")throw new Error(`IMAGE_CONVERSION_FAILED:${input.targetFile}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const sniff=(()=>{if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return"image/jpeg";if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return"image/png";if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return"image/webp";return"";})();
  if(sniff!==wanted)throw new Error(`IMAGE_CONVERSION_FORMAT_MISMATCH:${input.targetFile}:actual=${sniff||"unknown"}:expected=${wanted}`);
  const token=await sha256Hex(`${input.assetId}\n${input.assetHash||input.r2Key}\n${wanted}`);const convertedKey=`projects/${input.projectId}/exports/transcoded/${token}.${formatLabelForMime(wanted)}`;
  const existing=await env.MEDIA.head(convertedKey);if(!existing)await env.MEDIA.put(convertedKey,bytes,{httpMetadata:{contentType:wanted},customMetadata:{sourceAssetId:input.assetId,targetFile:input.targetFile,technicalConversion:"true"}});
  const head=existing||await env.MEDIA.head(convertedKey);return{r2Key:convertedKey,sizeBytes:Number(head?.size||bytes.length),mime:wanted,converted:true};
}

async function reconcileProductionScenesLight(env:Env,input:{projectId:string;version:number;scenes:ReturnType<typeof parseProjectScriptScenes>}){
  const ts=nowMs();
  const sceneIds=new Map<number,string>();
  const sceneStatements:D1PreparedStatement[]=[];
  for(const scene of input.scenes){
    const sceneId=await stableId("PSCENE",`${input.projectId}\n${input.version}\n${scene.itemKey}`,12);
    sceneIds.set(scene.number,sceneId);
    sceneStatements.push(env.DB.prepare(`INSERT INTO v2_production_scenes(id,project_id,version,scene_key,scene_number,title,universe,subject,concept,semantic_reference,script_excerpt,preset,context,composition_class,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'READY',?,?)
      ON CONFLICT(project_id,version,scene_key) DO UPDATE SET scene_number=excluded.scene_number,title=excluded.title,universe=COALESCE(NULLIF(excluded.universe,''),v2_production_scenes.universe),subject=COALESCE(NULLIF(excluded.subject,''),v2_production_scenes.subject),concept=COALESCE(NULLIF(excluded.concept,''),v2_production_scenes.concept),semantic_reference=COALESCE(NULLIF(excluded.semantic_reference,''),v2_production_scenes.semantic_reference),script_excerpt=excluded.script_excerpt,preset=COALESCE(NULLIF(excluded.preset,''),v2_production_scenes.preset),context=excluded.context,composition_class=excluded.composition_class,status='READY',updated_at=excluded.updated_at`)
      .bind(sceneId,input.projectId,input.version,scene.itemKey,scene.number,scene.title||scene.itemKey,scene.universe||null,scene.subject||null,scene.concept||null,scene.reference||null,scene.scriptExcerpt||null,scene.preset||null,scene.scriptExcerpt||null,scene.compositionClass||"CONTEXTUAL",ts,ts));
  }
  for(let offset=0;offset<sceneStatements.length;offset+=50)await env.DB.batch(sceneStatements.slice(offset,offset+50));

  // Existing 102/102 slots are production truth. Only repair their scene_id using
  // the numeric target prefix; never touch asset_id/status/reference pools here.
  const slotRows=await env.DB.prepare("SELECT id,target_file,scene_id FROM v2_production_slots WHERE project_id=? AND version=?").bind(input.projectId,input.version).all<Record<string,unknown>>();
  const slotUpdates:D1PreparedStatement[]=[];let relinked=0;
  for(const slot of slotRows.results||[]){
    const match=clean(slot.target_file).match(/^0*(\d{1,4})[-_ ]/);if(!match)continue;
    const number=Number(match[1]),sceneId=sceneIds.get(number);if(!sceneId||clean(slot.scene_id)===sceneId)continue;
    slotUpdates.push(env.DB.prepare("UPDATE v2_production_slots SET scene_id=?,updated_at=? WHERE id=?").bind(sceneId,ts,slot.id));relinked++;
  }
  for(let offset=0;offset<slotUpdates.length;offset+=50)await env.DB.batch(slotUpdates.slice(offset,offset+50));
  await env.DB.batch([
    env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId),
    env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),input.projectId,"PRODUCTION_SCENES_FAST_RECONCILED","OK",JSON.stringify({questions:input.scenes.length,sceneUpserts:sceneStatements.length,slotSceneRelinks:relinked,preservedSlots:true,preservedAssets:true}),ts),
  ]);
  const row=await env.DB.prepare("SELECT COUNT(*) total FROM v2_production_scenes WHERE project_id=? AND version=?").bind(input.projectId,input.version).first<Record<string,unknown>>();
  return{sceneCount:Number(row?.total||0),relinked};
}

async function validateScriptStructure(env:Env,projectId:string){
  const script=await activeScript(env,projectId);const parsed=parseProjectScriptScenes(script.text);const refs=scriptImageRefs(script.text);
  if(parsed.length>100)throw new Error(`FORMA_QUESTION_LIMIT_EXCEEDED:${parsed.length}:max=100`);
  if(refs.length>250)throw new Error(`FORMA_IMAGE_LIMIT_EXCEEDED:${refs.length}:max=250`);
  const project=await env.DB.prepare("SELECT active_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)throw new Error("PROJECT_NOT_FOUND");const version=Number(project.active_version||1);
  let sceneCount=Number((await env.DB.prepare("SELECT COUNT(*) total FROM v2_production_scenes WHERE project_id=? AND version=?").bind(projectId,version).first<Record<string,unknown>>())?.total||0);
  if(parsed.length!==sceneCount){
    // Export must not rebuild pools/slots. Repair scenes only, in D1 batches, then
    // continue using the already-resolved production slots. This keeps the Queue
    // hot path short enough to finish PROJECT_SCRIPT_TXT / PROJECT_IMAGES_ZIP.
    const repaired=await reconcileProductionScenesLight(env,{projectId,version,scenes:parsed});sceneCount=repaired.sceneCount;
  }
  if(parsed.length!==sceneCount)throw new Error(`PRODUCTION_SCENES_MISMATCH:questions_script=${parsed.length}:production_scenes_total=${sceneCount}`);
  return{script,questions:parsed.length,imageRefs:refs,sceneCount,version};
}

async function finalImagesBundle(env:Env,projectId:string){
  const structure=await validateScriptStructure(env,projectId);if(!structure.imageRefs.length)throw new Error("SCRIPT_HAS_NO_IMAGE_REFERENCES");
  const rows=await env.DB.prepare(`SELECT s.*,a.r2_key,a.mime_type,a.size_bytes,a.sha256 asset_sha256 FROM v2_production_slots s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=? AND s.version=? ORDER BY s.created_at`).bind(projectId,structure.version).all<Record<string,unknown>>();
  const slots=rows.results||[];const unresolved=slots.filter(s=>!clean(s.asset_id)||!clean(s.r2_key)||!RESOLVED_SLOT_STATES.has(clean(s.status).toUpperCase()));if(unresolved.length)throw new Error(`PRODUCTION_SLOTS_INCOMPLETE:${unresolved.length}`);
  const byTarget=new Map<string,Record<string,unknown>[]>();for(const slot of slots){const key=normalizeTarget(clean(slot.target_file));if(!key)continue;const arr=byTarget.get(key)||[];arr.push(slot);byTarget.set(key,arr);}
  const duplicateTargets=[...byTarget.entries()].filter(([,list])=>list.length>1).map(([name])=>name);if(duplicateTargets.length)throw new Error(`DUPLICATE_TARGET_NAMES:${duplicateTargets.slice(0,20).join(",")}`);
  const missing=structure.imageRefs.filter(name=>!byTarget.has(normalizeTarget(name)));if(missing.length)throw new Error(`SCRIPT_IMAGE_REFS_MISSING_SLOTS:${missing.length}:${missing.slice(0,20).join(",")}`);
  const preparedEntries=await mapLimit(structure.imageRefs,10,async name=>{
    const slot=byTarget.get(normalizeTarget(name))![0];const preset=clean(slot.preset).toUpperCase();
    if(["CENTRAL_2","FOCO_4"].includes(preset)&&expectedMimeForTarget(name)!=="image/png")throw new Error(`TRANSPARENCY_PRESET_REQUIRES_PNG:${name}:${preset}`);
    const prepared=await ensureImageTargetFormat(env,{projectId,assetId:clean(slot.asset_id),r2Key:clean(slot.r2_key),targetFile:name,sourceMime:clean(slot.mime_type),assetHash:clean(slot.asset_sha256)});
    return{name:safeName(name),prepared};
  });
  let converted=0;const entries:ZipEntry[]=preparedEntries.map(({name,prepared})=>{if(prepared.converted)converted++;return{name,r2Key:prepared.r2Key,sizeBytes:prepared.sizeBytes,open:async()=>{const obj=await env.MEDIA.get(prepared.r2Key);if(!obj)throw new Error(`R2_OBJECT_MISSING:${prepared.r2Key}`);return obj.body;}};});
  return{entries,structure,slotsTotal:slots.length,converted,expectedNames:structure.imageRefs.map(safeName),preflightConcurrency:10};
}

async function finalPublicationBundle(env:Env,projectId:string){
  const [media,titles]=await Promise.all([
    env.DB.prepare("SELECT * FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND status NOT IN ('REJECTED','THUMB_REJECTED') ORDER BY selected DESC,slot_index,created_at LIMIT 3").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT * FROM v2_project_titles WHERE project_id=? AND status NOT IN ('REJECTED','TITLE_REJECTED') ORDER BY selected DESC,slot_index,created_at LIMIT 3").bind(projectId).all<Record<string,unknown>>(),
  ]);
  const thumbs=media.results||[],titleRows=titles.results||[];const entries:ZipEntry[]=[];
  for(let i=0;i<thumbs.length;i++){const row=thumbs[i],key=clean(row.r2_key);if(!key)continue;const ext=fileExt(clean(row.mime_type));const name=`thumbs/thumb-${String(i+1).padStart(2,"0")}.${ext}`;entries.push({name,r2Key:key,sizeBytes:Number(row.size_bytes||0),open:async()=>{const obj=await env.MEDIA.get(key);if(!obj)throw new Error(`R2_OBJECT_MISSING:${key}`);return obj.body;}});}
  const selected=titleRows.find(row=>Number(row.selected||0)===1);const project=await env.DB.prepare("SELECT name FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  const text=[`TITULOS — ${clean(project?.name)||projectId}`,"=".repeat(48),"",...titleRows.map((row,i)=>`${i+1}. ${clean(row.text)}`),"",selected?`TITULO_SELECIONADO:\n${clean(selected.text)}`:"TITULO_SELECIONADO:\nNenhum título selecionado.",""].join("\n");const bytes=new TextEncoder().encode(text);entries.push({name:"titulos.txt",sizeBytes:bytes.length,open:async()=>bytes});
  return{entries,thumbCount:thumbs.length,titleCount:titleRows.length};
}

async function publicationReadiness(env:Env,projectId:string){
  const [thumbs,titles]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND status NOT IN ('REJECTED','THUMB_REJECTED') AND r2_key IS NOT NULL").bind(projectId).first<Record<string,unknown>>(),
    env.DB.prepare("SELECT COUNT(*) total FROM v2_project_titles WHERE project_id=? AND status NOT IN ('REJECTED','TITLE_REJECTED') AND trim(COALESCE(text,''))<>''").bind(projectId).first<Record<string,unknown>>(),
  ]);const thumbCount=Number(thumbs?.total||0),titleCount=Number(titles?.total||0);return{ready:thumbCount>0&&titleCount>0,thumbCount,titleCount};
}

async function artifactRevisionHash(env:Env,projectId:string,type:FinalArtifactType){
  const scriptRow=await env.DB.prepare("SELECT content_hash FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId).first<Record<string,unknown>>();
  const scriptHash=clean(scriptRow?.content_hash)||(await activeScript(env,projectId)).hash;
  if(type==="PROJECT_SCRIPT_TXT")return await sha256Hex(`SCRIPT
${scriptHash}`);
  if(type==="PROJECT_IMAGES_ZIP"){const project=await env.DB.prepare("SELECT active_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)throw new Error("PROJECT_NOT_FOUND");const version=Number(project.active_version||1);const rows=await env.DB.prepare("SELECT s.target_file,s.asset_id,s.status,a.sha256 asset_sha256 FROM v2_production_slots s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=? AND s.version=? ORDER BY s.target_file").bind(projectId,version).all<Record<string,unknown>>();return await sha256Hex(JSON.stringify({script:scriptHash,slots:rows.results||[]}));}
  const [media,titles]=await Promise.all([env.DB.prepare("SELECT id,r2_key,status,selected,slot_index,updated_at FROM v2_project_media WHERE project_id=? AND kind='THUMB' AND status NOT IN ('REJECTED','THUMB_REJECTED') ORDER BY slot_index,id").bind(projectId).all<Record<string,unknown>>(),env.DB.prepare("SELECT id,text,status,selected,slot_index,updated_at FROM v2_project_titles WHERE project_id=? AND status NOT IN ('REJECTED','TITLE_REJECTED') ORDER BY slot_index,id").bind(projectId).all<Record<string,unknown>>()]);return await sha256Hex(JSON.stringify({media:media.results||[],titles:titles.results||[]}));
}

async function zipIndexNames(env:Env,key:string,size:number){
  const getRange=(offset:number,length:number)=>(env.MEDIA as unknown as {get:(key:string,opts?:unknown)=>Promise<R2ObjectBody|null>}).get(key,{range:{offset,length}});
  const tailLength=Math.min(size,65557),tailOffset=Math.max(0,size-tailLength),tailObj=await getRange(tailOffset,tailLength);if(!tailObj)return[];const tail=new Uint8Array(await tailObj.arrayBuffer());let eocd=-1;for(let i=tail.length-22;i>=0;i--){if(tail[i]===0x50&&tail[i+1]===0x4b&&tail[i+2]===0x05&&tail[i+3]===0x06){eocd=i;break;}}if(eocd<0)throw new Error("ZIP_INDEX_EOCD_NOT_FOUND");const tailView=new DataView(tail.buffer,tail.byteOffset,tail.byteLength),count=tailView.getUint16(eocd+10,true),centralSize=tailView.getUint32(eocd+12,true),centralOffset=tailView.getUint32(eocd+16,true);const centralObj=await getRange(centralOffset,centralSize);if(!centralObj)throw new Error("ZIP_INDEX_CENTRAL_DIRECTORY_MISSING");const bytes=new Uint8Array(await centralObj.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();const names:string[]=[];let cursor=0;for(let i=0;i<count;i++){if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)throw new Error("ZIP_INDEX_INVALID_CENTRAL_DIRECTORY");const nameLen=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);names.push(decoder.decode(bytes.slice(cursor+46,cursor+46+nameLen)));cursor+=46+nameLen+extra+comment;}return names;
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
  const guard=await projectExportGuard(env,input.projectId);if(!guard.ok)return guard;const project=guard.project as Record<string,unknown>;
  const production=await productionCompletionGate(env,input.projectId).catch(()=>null);
  const type=clean(input.type||"PROJECT_IMAGES_ZIP").toUpperCase();
  const isFinal=FINAL_ARTIFACT_TYPES.has(type as FinalArtifactType);
  if((type==="PROJECT_IMAGES_ZIP"||type==="PROJECT_PRODUCTION_ZIP"||type==="FULL_PROJECT_ZIP")&&Number(production?.production_slots_total||0)>0&&Number(production?.production_slots_resolved||0)<Number(production?.production_slots_total||0))return{error:"PRODUCTION_SLOTS_INCOMPLETE",status:409,...production}as const;
  if(!isFinal&&!['FULL_PROJECT_ZIP','PROJECT_PRODUCTION_ZIP'].includes(type))return{error:"PACKAGE_TYPE_NOT_SUPPORTED",status:400,allowed:[...FINAL_ARTIFACT_TYPES,'PROJECT_PRODUCTION_ZIP']}as const;
  if(type==="PROJECT_PUBLICATION_ZIP"){const readiness=await publicationReadiness(env,input.projectId);if(!readiness.ready)return{error:"PUBLICATION_ARTIFACT_NOT_READY",status:409,...readiness,independent:true}as const;}
  const revision=projectRevision(project),operationId=clean(input.operationId)||id("OP");
  const revisionHash=isFinal?await artifactRevisionHash(env,input.projectId,type as FinalArtifactType):null;
  const byOp=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE operation_id=?").bind(operationId).first<Record<string,unknown>>();if(byOp)return{...byOp,reused:true,httpStatus:202}as const;
  const existing=isFinal?await env.DB.prepare("SELECT * FROM v2_download_packages WHERE project_id=? AND type=? AND revision_hash=? AND status NOT IN ('FAILED') ORDER BY created_at DESC LIMIT 1").bind(input.projectId,type,revisionHash).first<Record<string,unknown>>():await env.DB.prepare("SELECT * FROM v2_download_packages WHERE project_id=? AND project_revision=? AND type=? AND status NOT IN ('FAILED') ORDER BY created_at DESC LIMIT 1").bind(input.projectId,revision,type).first<Record<string,unknown>>();
  if(existing){
    const status=clean(existing.status).toUpperCase();
    if(["READY_FOR_DOWNLOAD","DOWNLOADED","COMPLETED"].includes(status))return{...existing,reused:true,httpStatus:200}as const;
    const ageMs=Math.max(0,nowMs()-Number(existing.updated_at||existing.created_at||0));
    if(["QUEUED","PROCESSING"].includes(status)&&ageMs>=90_000){
      const staleOperationId=clean(existing.operation_id);const stalePackageId=clean(existing.id);const recoveredAt=nowMs();
      await env.DB.batch([
        env.DB.prepare("UPDATE v2_download_packages SET status='QUEUED',error='STALE_EXPORT_REQUEUED',updated_at=? WHERE id=?").bind(recoveredAt,stalePackageId),
        env.DB.prepare("UPDATE v2_ingest_operations SET status='QUEUED',error=NULL,failed=0,updated_at=? WHERE id=?").bind(recoveredAt,staleOperationId),
        env.DB.prepare("UPDATE v2_control_jobs SET status='QUEUED',error=NULL,updated_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(recoveredAt,staleOperationId),
        env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),input.projectId,"FINAL_ARTIFACT_STALE_REQUEUED","QUEUED",JSON.stringify({packageId:stalePackageId,type,previousStatus:status,ageMs}),recoveredAt),
      ]);
      await env.MATERIALIZE_QUEUE.send({kind:"GENERATE_PACKAGE",operationId:staleOperationId,packageId:stalePackageId,projectId:input.projectId} satisfies CorvoQueueJob);
      return{...existing,status:"QUEUED",reused:true,recovered_from_stale:true,previous_status:status,stale_age_ms:ageMs,httpStatus:202}as const;
    }
    return{...existing,reused:true,stale:false,httpStatus:202}as const;
  }
  await updateProjectWorkflow(env,{projectId:input.projectId,activate:["DOWNLOADER_WORKING"],ownerId:"MCP_DOWNLOADER",executionId:operationId,ttlSeconds:600,metadata:{source:"queue_final_package",type}}).catch(()=>undefined);
  const packageId=id("PKG"),jobId=id("JOB"),ts=nowMs();await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_download_packages (id,operation_id,project_id,project_revision,type,status,revision_hash,mime_type,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',?,?,?,?)").bind(packageId,operationId,input.projectId,revision,type,revisionHash,mimeForArtifactType(type),ts,ts),
    env.DB.prepare("INSERT INTO v2_ingest_operations (id,type,status,requested,succeeded,failed,payload_json,created_at,updated_at) VALUES (?,'GENERATE_PACKAGE','QUEUED',1,0,0,?,?,?)").bind(operationId,JSON.stringify({packageId,projectId:input.projectId,revision,type,revisionHash}),ts,ts),
    env.DB.prepare("INSERT INTO v2_control_jobs (id,operation_id,kind,project_id,status,payload_json,created_at,updated_at) VALUES (?,?,'GENERATE_PACKAGE',?,'QUEUED',?,?,?)").bind(jobId,operationId,input.projectId,JSON.stringify({packageId,revision,type,revisionHash}),ts,ts),
  ]);await env.MATERIALIZE_QUEUE.send({kind:"GENERATE_PACKAGE",operationId,packageId,projectId:input.projectId} satisfies CorvoQueueJob);return{package_id:packageId,operation_id:operationId,project_id:input.projectId,project_revision:revision,revision_hash:revisionHash,type,status:"QUEUED",reused:false,httpStatus:202}as const;
}

export async function queueFinalExports(env:Env,input:{projectId:string;types?:FinalArtifactType[]}){
  const requested=((input.types?.length?input.types:["PROJECT_IMAGES_ZIP","PROJECT_SCRIPT_TXT","PROJECT_PUBLICATION_ZIP"] as FinalArtifactType[])).filter((value,index,all)=>FINAL_ARTIFACT_TYPES.has(value)&&all.indexOf(value)===index);
  const results=[] as unknown[];
  for(const type of requested){try{results.push(await queueFinalPackage(env,{projectId:input.projectId,type,operationId:`${id("OP")}-${type}`}));}catch(error){results.push({type,error:error instanceof Error?error.message:String(error)});}}
  return{project_id:input.projectId,independent:true,requested:requested.length,artifacts:results};
}

export async function processPackageJob(env:Env,job:PackageJob){
  const ts=nowMs();const packageRow=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(job.packageId).first<Record<string,unknown>>();if(!packageRow)throw new Error("PACKAGE_NOT_FOUND");const type=clean(packageRow.type).toUpperCase();const isFinal=FINAL_ARTIFACT_TYPES.has(type as FinalArtifactType);
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_download_packages SET status='PROCESSING',error=NULL,updated_at=? WHERE id=?").bind(ts,job.packageId),
    env.DB.prepare("UPDATE v2_ingest_operations SET status='PROCESSING',updated_at=? WHERE id=?").bind(ts,job.operationId),
    env.DB.prepare("UPDATE v2_control_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(ts,job.operationId),
  ]);
  try{
    let fileName=filenameForArtifactType(type),r2Key="",actualSize=0,sha256:string|null=null,resultMeta:Record<string,unknown>={type};
    const project=await env.DB.prepare("SELECT * FROM automatic_projects WHERE id=?").bind(job.projectId).first<Record<string,unknown>>();if(!project)throw new Error("PROJECT_NOT_FOUND");const revision=projectRevision(project);const revisionHash=clean(packageRow.revision_hash)||String(revision);
    if(type==="PROJECT_SCRIPT_TXT"){
      const structure=await validateScriptStructure(env,job.projectId);const bytes=structure.script.bytes;fileName="roteiro.txt";r2Key=`projects/${job.projectId}/exports/${revisionHash}/roteiro.txt`;sha256=await sha256Hex(bytes);await env.MEDIA.put(r2Key,bytes,{httpMetadata:{contentType:"text/plain; charset=utf-8",contentDisposition:'attachment; filename="roteiro.txt"'},customMetadata:{projectId:job.projectId,artifactType:type,revisionHash,questions:String(structure.questions),imageRefs:String(structure.imageRefs.length)}});const head=await env.MEDIA.head(r2Key);actualSize=Number(head?.size||0);if(!head||actualSize!==bytes.length)throw new Error(`TXT_R2_SIZE_MISMATCH:expected=${bytes.length}:actual=${actualSize}`);resultMeta={...resultMeta,questions:structure.questions,imageRefs:structure.imageRefs.length,productionScenes:structure.sceneCount,utf8:true};
    }else if(type==="PROJECT_IMAGES_ZIP"){
      const bundle=await finalImagesBundle(env,job.projectId);fileName="imagens.zip";r2Key=`projects/${job.projectId}/exports/${revisionHash}/imagens.zip`;const zipped=await fixedLengthZipStream(env,bundle.entries);const put=env.MEDIA.put(r2Key,zipped.stream,{httpMetadata:{contentType:"application/zip",contentDisposition:'attachment; filename="imagens.zip"'},customMetadata:{projectId:job.projectId,artifactType:type,revisionHash,knownLength:String(zipped.expectedSize),flat:"true",imageCount:String(bundle.expectedNames.length)}});const [, ,zipHash]=await Promise.all([put,zipped.completion,zipped.sha256]);sha256=zipHash;const head=await env.MEDIA.head(r2Key);actualSize=Number(head?.size||0);if(!head||actualSize!==zipped.expectedSize)throw new Error(`ZIP_R2_SIZE_MISMATCH:expected=${zipped.expectedSize}:actual=${actualSize}`);const indexed=await zipIndexNames(env,r2Key,actualSize);const expected=bundle.expectedNames.map(safeName);const missing=expected.filter(name=>!indexed.includes(name)),unexpected=indexed.filter(name=>!expected.includes(name)),duplicates=indexed.filter((name,i)=>indexed.indexOf(name)!==i);if(missing.length||unexpected.length||duplicates.length)throw new Error(`FORMA_ZIP_INDEX_MISMATCH:missing=${missing.length}:unexpected=${unexpected.length}:duplicates=${duplicates.length}`);resultMeta={...resultMeta,images:expected.length,productionSlots:bundle.slotsTotal,convertedFormats:bundle.converted,fixedLengthStream:true,flat:true,missing:0,unexpected:0,duplicateNames:0,invalidFormat:0};
    }else if(type==="PROJECT_PUBLICATION_ZIP"){
      const bundle=await finalPublicationBundle(env,job.projectId);fileName="thumbs_titulos.zip";r2Key=`projects/${job.projectId}/exports/${revisionHash}/thumbs_titulos.zip`;const zipped=await fixedLengthZipStream(env,bundle.entries);const put=env.MEDIA.put(r2Key,zipped.stream,{httpMetadata:{contentType:"application/zip",contentDisposition:'attachment; filename="thumbs_titulos.zip"'},customMetadata:{projectId:job.projectId,artifactType:type,revisionHash,knownLength:String(zipped.expectedSize)}});const [, ,zipHash]=await Promise.all([put,zipped.completion,zipped.sha256]);sha256=zipHash;const head=await env.MEDIA.head(r2Key);actualSize=Number(head?.size||0);if(!head||actualSize!==zipped.expectedSize)throw new Error(`ZIP_R2_SIZE_MISMATCH:expected=${zipped.expectedSize}:actual=${actualSize}`);const indexed=await zipIndexNames(env,r2Key,actualSize),expected=bundle.entries.map(entry=>entry.name),missing=expected.filter(name=>!indexed.includes(name)),unexpected=indexed.filter(name=>!expected.includes(name)),duplicates=indexed.filter((name,i)=>indexed.indexOf(name)!==i);if(missing.length||unexpected.length||duplicates.length)throw new Error(`PUBLICATION_ZIP_INDEX_MISMATCH:missing=${missing.length}:unexpected=${unexpected.length}:duplicates=${duplicates.length}`);resultMeta={...resultMeta,thumbs:bundle.thumbCount,titles:bundle.titleCount,fixedLengthStream:true,missing:0,unexpected:0,duplicateNames:0};
    }else{
      const bundle=await projectBundleEntries(env,job.projectId);fileName=`${safeName(clean(bundle.project.name)||job.projectId).replace(/\s+/g,"_").toUpperCase()}_PRODUCAO.zip`;r2Key=`projects/${job.projectId}/production/exports/r${revision}-${Date.now()}-${fileName}`;const zipped=await fixedLengthZipStream(env,bundle.entries);const put=env.MEDIA.put(r2Key,zipped.stream,{httpMetadata:{contentType:"application/zip",contentDisposition:`attachment; filename=\"${fileName.replace(/[\"\\\r\n]/g,"-")}\"`},customMetadata:{projectId:job.projectId,revision:String(revision),packageId:job.packageId,knownLength:String(zipped.expectedSize)}});const [, ,zipHash]=await Promise.all([put,zipped.completion,zipped.sha256]);sha256=zipHash;const head=await env.MEDIA.head(r2Key);actualSize=Number(head?.size||0);if(!head||actualSize!==zipped.expectedSize)throw new Error(`ZIP_R2_SIZE_MISMATCH:expected=${zipped.expectedSize}:actual=${actualSize}`);resultMeta={...resultMeta,images:bundle.imageCount,thumbs:bundle.thumbCount,titles:bundle.titleCount,productionSlots:bundle.productionSlotCount,fixedLengthStream:true};
    }
    const done=nowMs();const statements=[
      env.DB.prepare("UPDATE v2_download_packages SET status='READY_FOR_DOWNLOAD',r2_key=?,file_name=?,size_bytes=?,sha256=?,mime_type=?,ready_at=?,updated_at=?,error=NULL WHERE id=?").bind(r2Key,fileName,actualSize,sha256,mimeForArtifactType(type),done,done,job.packageId),
      env.DB.prepare("UPDATE v2_ingest_operations SET status='COMPLETED',succeeded=1,failed=0,updated_at=? WHERE id=?").bind(done,job.operationId),
      env.DB.prepare("UPDATE v2_control_jobs SET status='COMPLETED',result_json=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(JSON.stringify({packageId:job.packageId,r2Key,fileName,sizeBytes:actualSize,...resultMeta}),done,done,job.operationId),
      env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),job.projectId,isFinal?"FINAL_ARTIFACT_READY":"PACKAGE_EXPORT_READY","READY_FOR_DOWNLOAD",JSON.stringify({packageId:job.packageId,r2Key,fileName,sizeBytes:actualSize,...resultMeta}),done),
      env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,updated_at=? WHERE id=?").bind(done,job.projectId),
    ];
    if(type==="PROJECT_IMAGES_ZIP")statements.push(env.DB.prepare("UPDATE automatic_projects SET zip_r2_key=?,zip_file_name=?,zip_size_bytes=? WHERE id=?").bind(r2Key,fileName,actualSize,job.projectId));
    await env.DB.batch(statements);await updateProjectWorkflow(env,{projectId:job.projectId,clear:["DOWNLOADER_WORKING"],metadata:{packageId:job.packageId,type,ready:true}}).catch(()=>undefined);await reconcileAutomaticProject(env,job.projectId).catch(()=>undefined);return{packageId:job.packageId,type,status:"READY_FOR_DOWNLOAD",r2Key,fileName,sizeBytes:actualSize,...resultMeta};
  }catch(error){
    const message=error instanceof Error?error.message:String(error),done=nowMs(),infra=zipInfrastructureFailure(message);
    await env.DB.batch([
      env.DB.prepare("UPDATE v2_download_packages SET status='FAILED',error=?,updated_at=? WHERE id=?").bind(message,done,job.packageId),
      env.DB.prepare("UPDATE v2_ingest_operations SET status='FAILED',failed=1,error=?,updated_at=? WHERE id=?").bind(message,done,job.operationId),
      env.DB.prepare("UPDATE v2_control_jobs SET status='FAILED',error=?,updated_at=?,completed_at=? WHERE operation_id=? AND kind='GENERATE_PACKAGE'").bind(message,done,done,job.operationId),
      env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),job.projectId,isFinal?"FINAL_ARTIFACT_FAILED":infra?"PACKAGE_EXPORT_BLOCKED":"PACKAGE_EXPORT_FAILED",isFinal?"FAILED":infra?"PACKAGE_BLOCKED_INFRASTRUCTURE":"FAILED",JSON.stringify({packageId:job.packageId,type,error:message,independent:isFinal}),done),
      env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,updated_at=? WHERE id=?").bind(done,job.projectId),
    ]);await updateProjectWorkflow(env,{projectId:job.projectId,clear:["DOWNLOADER_WORKING"],metadata:{packageId:job.packageId,type,error:message,infra,independent:isFinal}}).catch(()=>undefined);
    if(infra&&!isFinal)await env.DB.prepare("UPDATE automatic_projects SET status='PACKAGE_BLOCKED_INFRASTRUCTURE',pipeline_status='PACKAGE_BLOCKED_INFRASTRUCTURE',next_action='CORRIGIR_EXPORTADOR_ZIP_FIXED_LENGTH_STREAM',state_version=state_version+1,updated_at=? WHERE id=?").bind(done,job.projectId).run().catch(()=>undefined);
    // Final artifacts are independent. Their failure is already durably persisted above;
    // returning lets the queue ACK the message instead of retrying it and flipping FAILED back to PROCESSING.
    if(isFinal)return{packageId:job.packageId,type,status:"FAILED",error:message,independent:true};
    throw error;
  }
}

export async function listReadyPackages(env:Env,input:{projectId?:string;status?:string;limit?:number}={}){const where:string[]=[];const values:unknown[]=[];if(input.projectId){where.push("p.project_id=?");values.push(input.projectId)}if(input.status&&input.status!=="ALL"){where.push("p.status=?");values.push(input.status)}else if(!input.status)where.push("p.status='READY_FOR_DOWNLOAD'");values.push(Math.max(1,Math.min(input.limit||100,200)));const rows=await env.DB.prepare(`SELECT p.*,a.name AS project_name FROM v2_download_packages p LEFT JOIN automatic_projects a ON a.id=p.project_id ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY p.created_at DESC LIMIT ?`).bind(...values).all<Record<string,unknown>>();return{total:(rows.results||[]).length,packages:rows.results||[]};}
export async function getPackageLink(request:Request,env:Env,packageId:string,ttlMinutes=30){const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row)return{error:"PACKAGE_NOT_FOUND",status:404}as const;if(!["READY_FOR_DOWNLOAD","DOWNLOADED"].includes(clean(row.status)))return{error:`PACKAGE_NOT_READY:${clean(row.status)}`,status:409}as const;const ttl=Math.max(1,Math.min(ttlMinutes,60))*60;return{package_id:packageId,project_id:row.project_id,status:row.status,download_url:await createSignedPackageUrl(request,packageId,env,ttl),expires_at:new Date(Date.now()+ttl*1000).toISOString(),filename:row.file_name,size_bytes:Number(row.size_bytes||0),sha256:row.sha256||null,direct_to_pc:true,chat_file_delivery:"DISABLED",httpStatus:200}as const;}
export async function servePackageFile(request:Request,packageId:string,env:Env){if(!(await validSignedPackageRequest(request,packageId,env)))return new Response("Forbidden",{status:403});const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row?.r2_key)return new Response("Not found",{status:404});const obj=await env.MEDIA.get(clean(row.r2_key));if(!obj)return new Response("Not found",{status:404});const fileName=safeName(clean(row.file_name)||`${packageId}.bin`);const mime=clean(row.mime_type)||mimeForArtifactType(clean(row.type));return new Response(obj.body,{headers:{"content-type":mime,"content-disposition":`attachment; filename=\"${fileName}\"`,"cache-control":"private, max-age=60","x-content-type-options":"nosniff"}});}

export async function getFinalProjectFiles(request:Request,env:Env,projectId:string,ttlMinutes=30){
  const project=await env.DB.prepare("SELECT id,name,state_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)return{error:"PROJECT_NOT_FOUND",status:404}as const;
  const rows=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE project_id=? AND type IN ('PROJECT_IMAGES_ZIP','PROJECT_SCRIPT_TXT','PROJECT_PUBLICATION_ZIP') ORDER BY created_at DESC").bind(projectId).all<Record<string,unknown>>();
  const latest=new Map<string,Record<string,unknown>>();for(const row of rows.results||[]){const type=clean(row.type);if(!latest.has(type))latest.set(type,row);}
  const ttl=Math.max(1,Math.min(ttlMinutes,60))*60;
  const expectedRevisions=new Map<FinalArtifactType,string|null>();for(const type of FINAL_ARTIFACT_TYPES){try{expectedRevisions.set(type,await artifactRevisionHash(env,projectId,type));}catch{expectedRevisions.set(type,null);}}
  const make=async(type:FinalArtifactType)=>{const row=latest.get(type);const storedStatus=clean(row?.status)||"MISSING",expectedRevision=expectedRevisions.get(type)||null,stale=Boolean(row&&expectedRevision&&clean(row.revision_hash)!==expectedRevision),status=stale?"STALE":storedStatus;const ready=!stale&&Boolean(row?.r2_key)&&["READY_FOR_DOWNLOAD","DOWNLOADED"].includes(storedStatus);return{artifact_type:type,label:type==="PROJECT_IMAGES_ZIP"?"IMAGENS":type==="PROJECT_SCRIPT_TXT"?"ROTEIRO":"THUMBS + TÍTULOS",status,stored_status:storedStatus,stale,file_name:clean(row?.file_name)||filenameForArtifactType(type),size_bytes:Number(row?.size_bytes||0),sha256:row?.sha256||null,revision_hash:row?.revision_hash||null,expected_revision_hash:expectedRevision,ready_at:row?.ready_at||null,error:row?.error||null,download_url:ready?await createSignedPackageUrl(request,clean(row?.id),env,ttl):null,package_id:row?.id||null,direct_to_pc:true};};
  const [imagens,roteiro,publicacao]=await Promise.all([make("PROJECT_IMAGES_ZIP"),make("PROJECT_SCRIPT_TXT"),make("PROJECT_PUBLICATION_ZIP")]);
  return{project_id:projectId,project_name:project.name,state_version:Number(project.state_version||1),independent:true,one_click_download:true,artifacts:{imagens,roteiro,publicacao}};
}

export async function getFinalArtifactLink(request:Request,env:Env,projectId:string,type:FinalArtifactType,ttlMinutes=30){const all=await getFinalProjectFiles(request,env,projectId,ttlMinutes);if("error" in all)return all;const key=type==="PROJECT_IMAGES_ZIP"?"imagens":type==="PROJECT_SCRIPT_TXT"?"roteiro":"publicacao";const artifact=all.artifacts[key];if(!artifact.download_url)return{...artifact,error:`ARTIFACT_NOT_READY:${artifact.status}`,httpStatus:409}as const;return{...artifact,project_id:projectId,httpStatus:200}as const;}

export async function confirmPackageDownload(env:Env,packageId:string,input:{machineName?:string;sha256?:string}){const row=await env.DB.prepare("SELECT * FROM v2_download_packages WHERE id=?").bind(packageId).first<Record<string,unknown>>();if(!row)return{error:"PACKAGE_NOT_FOUND",status:404}as const;const guard=await projectExportGuard(env,clean(row.project_id));if(!guard.ok)return guard;const supplied=clean(input.sha256).toLowerCase(),expected=clean(row.sha256).toLowerCase();const verified=expected&&supplied?Number(expected===supplied):null;const ts=nowMs();await env.DB.prepare("UPDATE v2_download_packages SET status='DOWNLOADED',download_count=download_count+1,machine_name=?,sha256_verified=?,downloaded_at=?,updated_at=? WHERE id=?").bind(input.machineName||null,verified,ts,ts,packageId).run();const projectId=clean(row.project_id);if(projectId)await updateProjectWorkflow(env,{projectId,activate:["DOWNLOADER_COMPLETED"],clear:["DOWNLOADER_WORKING"],metadata:{packageId}}).catch(()=>undefined);return{package_id:packageId,status:"DOWNLOADED",sha256_verified:verified===null?null:Boolean(verified),downloaded_at:new Date(ts).toISOString()};}

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

