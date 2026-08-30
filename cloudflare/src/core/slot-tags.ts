import type { Env } from "../types";
import { id, nowMs } from "./ids";

const clean=(value:unknown)=>String(value??"").trim();
const normalizeTagKey=(value:unknown)=>clean(value).toUpperCase().replace(/\s+/g,"_");
const limitText=(value:unknown,max:number)=>clean(value).slice(0,max);

export type SlotVisualTag = {
  id:string;
  project_id:string;
  slot_id:string;
  tag_key:string;
  emoji:string;
  label:string;
  note:string|null;
  created_by:string|null;
  created_at:number;
  updated_at:number;
  active:boolean;
};

async function projectExists(env:Env,projectId:string){
  return Boolean(await env.DB.prepare("SELECT id FROM automatic_projects WHERE id=? LIMIT 1").bind(projectId).first<{id:string}>());
}

const mapTag=(row:Record<string,unknown>):SlotVisualTag=>({
  id:clean(row.id),project_id:clean(row.project_id),slot_id:clean(row.slot_id),tag_key:normalizeTagKey(row.tag_key),emoji:clean(row.emoji),label:clean(row.label),note:clean(row.note)||null,created_by:clean(row.created_by)||null,created_at:Number(row.created_at||0),updated_at:Number(row.updated_at||row.created_at||0),active:Boolean(Number(row.active??1)),
});

export async function createSlotTag(env:Env,input:{projectId:string;slotId:string;tagKey:string;emoji:string;label:string;note?:string;createdBy?:string}){
  const projectId=clean(input.projectId),slotId=clean(input.slotId),tagKey=normalizeTagKey(input.tagKey),emoji=limitText(input.emoji,24),label=limitText(input.label,160),note=limitText(input.note,4000)||null,createdBy=limitText(input.createdBy,160)||"MCP";
  if(!projectId||!slotId||!tagKey||!emoji||!label)return {error:"INVALID_SLOT_TAG",required:["project_id","slot_id","tag_key","emoji","label"],status:400} as const;
  if(!(await projectExists(env,projectId)))return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const existing=await env.DB.prepare("SELECT * FROM v2_slot_tags WHERE project_id=? AND slot_id=? AND tag_key=? LIMIT 1").bind(projectId,slotId,tagKey).first<Record<string,unknown>>();
  if(existing&&Number(existing.active||0)===1)return {ok:true,created:false,already_exists:true,tag:mapTag(existing)};
  const ts=nowMs();
  if(existing){
    await env.DB.prepare("UPDATE v2_slot_tags SET emoji=?,label=?,note=?,created_by=?,active=1,removed_at=NULL,updated_at=? WHERE id=?").bind(emoji,label,note,createdBy,ts,existing.id).run();
  }else{
    await env.DB.prepare(`INSERT INTO v2_slot_tags(id,project_id,slot_id,tag_key,emoji,label,note,created_by,created_at,updated_at,active,removed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,NULL)`).bind(id("STAG"),projectId,slotId,tagKey,emoji,label,note,createdBy,ts,ts).run();
  }
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,projectId).run();
  await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SLOT_TAG_CREATED","ACTIVE",JSON.stringify({slot_id:slotId,tag_key:tagKey,emoji,label,note,created_by:createdBy}),ts).run().catch(()=>undefined);
  const row=await env.DB.prepare("SELECT * FROM v2_slot_tags WHERE project_id=? AND slot_id=? AND tag_key=? LIMIT 1").bind(projectId,slotId,tagKey).first<Record<string,unknown>>();
  return {ok:true,created:true,reactivated:Boolean(existing),tag:row?mapTag(row):null};
}

export async function removeSlotTag(env:Env,input:{projectId:string;slotId:string;tagKey:string}){
  const projectId=clean(input.projectId),slotId=clean(input.slotId),tagKey=normalizeTagKey(input.tagKey);
  if(!projectId||!slotId||!tagKey)return {error:"INVALID_SLOT_TAG",status:400} as const;
  if(!(await projectExists(env,projectId)))return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const existing=await env.DB.prepare("SELECT * FROM v2_slot_tags WHERE project_id=? AND slot_id=? AND tag_key=? LIMIT 1").bind(projectId,slotId,tagKey).first<Record<string,unknown>>();
  if(!existing||Number(existing.active||0)!==1)return {ok:true,removed:false,already_inactive:true,project_id:projectId,slot_id:slotId,tag_key:tagKey};
  const ts=nowMs();
  await env.DB.prepare("UPDATE v2_slot_tags SET active=0,removed_at=?,updated_at=? WHERE id=?").bind(ts,ts,existing.id).run();
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,projectId).run();
  await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SLOT_TAG_REMOVED","REMOVED",JSON.stringify({slot_id:slotId,tag_key:tagKey}),ts).run().catch(()=>undefined);
  return {ok:true,removed:true,project_id:projectId,slot_id:slotId,tag_key:tagKey,removed_at:ts};
}

export async function listSlotTags(env:Env,input:{projectId:string;slotId:string}){
  const rows=await env.DB.prepare("SELECT * FROM v2_slot_tags WHERE project_id=? AND slot_id=? AND active=1 ORDER BY updated_at DESC,created_at DESC").bind(clean(input.projectId),clean(input.slotId)).all<Record<string,unknown>>();
  return {project_id:clean(input.projectId),slot_id:clean(input.slotId),tags:(rows.results||[]).map(mapTag)};
}

export async function listProjectTagsFlat(env:Env,projectId:string){
  const rows=await env.DB.prepare("SELECT * FROM v2_slot_tags WHERE project_id=? AND active=1 ORDER BY slot_id,updated_at DESC,created_at DESC").bind(clean(projectId)).all<Record<string,unknown>>();
  return (rows.results||[]).map(mapTag);
}

export async function listProjectTags(env:Env,projectId:string){
  const tags=await listProjectTagsFlat(env,projectId);const grouped:Record<string,SlotVisualTag[]>={};
  for(const tag of tags)(grouped[tag.slot_id]??=[]).push(tag);
  return {project_id:clean(projectId),total:tags.length,slots:grouped,tags};
}

export async function findSlotsByTag(env:Env,input:{tagKey:string;projectId?:string;projectStatus?:string;limit?:number}){
  const tagKey=normalizeTagKey(input.tagKey),limit=Math.max(1,Math.min(Number(input.limit||100),500));
  if(!tagKey)return {error:"TAG_KEY_REQUIRED",status:400} as const;
  const params:unknown[]=[tagKey];let where="t.active=1 AND t.tag_key=?";
  if(clean(input.projectId)){where+=" AND t.project_id=?";params.push(clean(input.projectId));}
  if(clean(input.projectStatus)){where+=" AND upper(COALESCE(p.lifecycle_status,p.status,''))=?";params.push(clean(input.projectStatus).toUpperCase());}
  params.push(limit);
  const rows=await env.DB.prepare(`SELECT t.*,p.name project_name,p.status project_status,p.pipeline_status,p.lifecycle_status,p.updated_at project_updated_at
    FROM v2_slot_tags t JOIN automatic_projects p ON p.id=t.project_id WHERE ${where}
    ORDER BY t.updated_at DESC LIMIT ?`).bind(...params).all<Record<string,unknown>>();
  return {tag_key:tagKey,total:(rows.results||[]).length,items:(rows.results||[]).map(row=>({...mapTag(row),project_name:row.project_name,project_status:row.project_status,pipeline_status:row.pipeline_status,lifecycle_status:row.lifecycle_status,project_updated_at:row.project_updated_at}))};
}
