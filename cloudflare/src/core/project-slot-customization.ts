import type { Env } from "../types";
import { id, nowMs, stableId } from "./ids";
import { enqueueFastPushItems } from "./ingest";
import { attachProjectScriptInline } from "./project-files";
import { configureProjectItemPipeline } from "./project-pipeline-state";
import { createProjectMediaFromCandidate, pushProjectTitles } from "./production";
import { projectWriteGuard } from "./project-workflow";

const clean=(value:unknown)=>String(value??"").trim();
export const PROJECT_SLOT_KEYS=["script","thumbs","titles","reference","candidates","approved","zip"] as const;
type ProjectSlotKey=(typeof PROJECT_SLOT_KEYS)[number];
const validSlot=(value:unknown):ProjectSlotKey|null=>{const key=clean(value).toLowerCase();return (PROJECT_SLOT_KEYS as readonly string[]).includes(key)?key as ProjectSlotKey:null;};

export async function configureProjectSlotAccess(env:Env,input:{projectId:string;slotKey:string;open:boolean;instruction?:string;openedBy?:string}){
  const slotKey=validSlot(input.slotKey); if(!slotKey)return {error:"INVALID_SLOT",allowed:PROJECT_SLOT_KEYS,status:400} as const;
  const guard=await projectWriteGuard(env,input.projectId); if(!guard.ok)return guard;
  const ts=nowMs();
  await env.DB.prepare(`INSERT INTO v2_project_slot_access(project_id,slot_key,mcp_open,instruction,opened_by,opened_at,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,slot_key) DO UPDATE SET mcp_open=excluded.mcp_open,instruction=excluded.instruction,opened_by=excluded.opened_by,opened_at=excluded.opened_at,updated_at=excluded.updated_at`)
    .bind(input.projectId,slotKey,input.open?1:0,clean(input.instruction)||null,clean(input.openedBy)||"UI",input.open?ts:null,ts).run();
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId).run();
  return {ok:true,projectId:input.projectId,slotKey,mcpOpen:input.open,instruction:clean(input.instruction)||null,updatedAt:ts};
}

export async function listProjectSlotAccess(env:Env,projectId?:string,onlyOpen=false){
  const params:unknown[]=[]; let where=" WHERE 1=1";
  if(projectId){where+=" AND project_id=?";params.push(projectId);} if(onlyOpen)where+=" AND mcp_open=1";
  const rows=await env.DB.prepare(`SELECT project_id,slot_key,mcp_open,instruction,opened_by,opened_at,updated_at FROM v2_project_slot_access${where} ORDER BY updated_at DESC LIMIT 500`).bind(...params).all<Record<string,unknown>>();
  return {items:(rows.results||[]).map(row=>({...row,mcp_open:Boolean(Number(row.mcp_open||0))}))};
}

async function requireOpenSlotForMcp(env:Env,projectId:string,slotKey:ProjectSlotKey){
  const row=await env.DB.prepare("SELECT mcp_open,instruction FROM v2_project_slot_access WHERE project_id=? AND slot_key=?").bind(projectId,slotKey).first<Record<string,unknown>>();
  if(!row||Number(row.mcp_open||0)!==1)return {ok:false,error:"PROJECT_SLOT_NOT_OPEN",projectId,slotKey,status:409} as const;
  return {ok:true,instruction:row.instruction||null} as const;
}

export async function fillProjectTextSlot(request:Request,env:Env,input:{projectId:string;slotKey:string;text:string;origin?:string;requireOpen?:boolean}){
  const slotKey=validSlot(input.slotKey);if(!slotKey||!["script","titles"].includes(slotKey))return {error:"TEXT_SLOT_REQUIRED",allowed:["script","titles"],status:400} as const;
  const guard=await projectWriteGuard(env,input.projectId);if(!guard.ok)return guard;
  if(input.requireOpen){const open=await requireOpenSlotForMcp(env,input.projectId,slotKey);if(!open.ok)return open;}
  const text=String(input.text??"").trim();if(!text)return {error:"EMPTY_TEXT",status:400} as const;
  let result:unknown;
  if(slotKey==="script") result=await attachProjectScriptInline(request,env,{projectId:input.projectId,content:text,fileName:"SCRIPT.txt"});
  else {
    const titles=text.split(/\r?\n/).map(value=>value.trim()).filter(Boolean).slice(0,3).map(value=>({text:value,agentOrigin:input.origin||"MANUAL_SLOT"}));
    result=await pushProjectTitles(env,input.projectId,titles);
  }
  return {ok:true,projectId:input.projectId,slotKey,result};
}

export async function fillProjectImageSlot(env:Env,input:{projectId:string;slotKey:string;url?:string;candidateId?:string;itemId?:string;targetCandidates?:number;requiredApproved?:number;origin?:string;requireOpen?:boolean}){
  const slotKey=validSlot(input.slotKey);if(!slotKey||!["thumbs","reference","candidates"].includes(slotKey))return {error:"IMAGE_SLOT_REQUIRED",allowed:["thumbs","reference","candidates"],status:400} as const;
  const guard=await projectWriteGuard(env,input.projectId);if(!guard.ok)return guard;
  if(input.requireOpen){const open=await requireOpenSlotForMcp(env,input.projectId,slotKey);if(!open.ok)return open;}
  if(input.candidateId){
    const candidate=await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(input.candidateId).first<Record<string,unknown>>();
    if(!candidate)return {error:"CANDIDATE_NOT_FOUND",status:404} as const;
    if(!["MATERIALIZED","APPROVED"].includes(clean(candidate.status).toUpperCase()))return {error:"CANDIDATE_NOT_MATERIALIZED",candidateStatus:candidate.status,status:409} as const;
    if(clean(candidate.project_id)&&clean(candidate.project_id)!==input.projectId)return {error:"CANDIDATE_ALREADY_LINKED_OTHER_PROJECT",candidateProjectId:candidate.project_id,status:409} as const;
    await env.DB.prepare("UPDATE v2_ingest_candidates SET project_id=?,item_id=COALESCE(item_id,?),updated_at=? WHERE id=?").bind(input.projectId,input.itemId||null,nowMs(),input.candidateId).run();
    if(slotKey==="thumbs"){
      const media=await createProjectMediaFromCandidate(env,{candidateId:input.candidateId,projectId:input.projectId,r2Key:clean(candidate.r2_key),mimeType:clean(candidate.mime_type)||"image/jpeg",sizeBytes:Number(candidate.size_bytes||0),sourceUrl:clean(candidate.source_url)||undefined,agentOrigin:input.origin||"PROJECT_SLOT"});
      return {ok:true,projectId:input.projectId,slotKey,candidateId:input.candidateId,media};
    }
    return {ok:true,projectId:input.projectId,slotKey,candidateId:input.candidateId,status:candidate.status};
  }
  const url=clean(input.url);if(!/^https?:\/\//i.test(url))return {error:"URL_REQUIRED",status:400} as const;
  let itemId=clean(input.itemId)||undefined;
  if(slotKey==="candidates"&&itemId){
    const configured=await configureProjectItemPipeline(env,input.projectId,itemId,{targetCandidates:input.targetCandidates,requiredApproved:input.requiredApproved});
    if(!configured)return {error:"PROJECT_ITEM_CONFIG_FAILED",status:409} as const;
    itemId=clean(configured.id)||itemId;
  }
  const tags=[`project-slot:${slotKey}`];if(slotKey==="thumbs")tags.push("thumb");if(slotKey==="reference")tags.push("reference");
  const result=await enqueueFastPushItems(env,[{url,projectId:input.projectId,itemId,tags}],{type:`PROJECT_SLOT_${slotKey.toUpperCase()}`});
  return {ok:true,projectId:input.projectId,slotKey,result};
}

export async function linkApprovedAssetToProjectSlot(env:Env,input:{projectId:string;assetId:string;itemId?:string;role?:string;requireOpen?:boolean}){
  const guard=await projectWriteGuard(env,input.projectId);if(!guard.ok)return guard;
  if(input.requireOpen){const open=await requireOpenSlotForMcp(env,input.projectId,"approved");if(!open.ok)return open;}
  const asset=await env.DB.prepare("SELECT id,name,status,r2_key FROM assets WHERE id=?").bind(input.assetId).first<Record<string,unknown>>();
  if(!asset)return {error:"ASSET_NOT_FOUND",status:404} as const;
  if(clean(asset.status).toLowerCase()!=="aprovado")return {error:"ASSET_NOT_APPROVED",assetStatus:asset.status,status:409} as const;
  const ts=nowMs();const itemKey=clean(input.itemId)||`MANUAL-${input.assetId}`;const itemId=await stableId("PITEM",`PROJECT_ASSET\n${input.projectId}\n${itemKey}\n${input.assetId}`,12);
  const project=await env.DB.prepare("SELECT active_version FROM automatic_projects WHERE id=?").bind(input.projectId).first<{active_version:number}>();
  const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO automatic_project_items
    (id,project_id,version,item_key,term,context,kind,status,priority,linked_asset_id,source_type,created_at,updated_at,target_candidates,required_approved,collection_status,qa_status,stage,strategy_state,composition_class)
    VALUES (?,?,?,?,?,NULL,?,'FROZEN',1,?,'LIBRARY_RELINK',?,?,0,0,'COMPLETE','QA_COMPLETE','COMPLETED','{}','CONTEXTUAL')`)
    .bind(itemId,input.projectId,Number(project?.active_version||1),itemKey,clean(asset.name)||input.assetId,clean(input.role)||"Imagem aprovada",input.assetId,ts,ts).run();
  const idempotent=Number((inserted as {meta?:{changes?:number}})?.meta?.changes||0)===0;
  if(!idempotent){
    await env.DB.prepare("UPDATE automatic_projects SET total_items=(SELECT COUNT(*) FROM automatic_project_items WHERE project_id=?),state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(input.projectId,ts,ts,input.projectId).run();
    await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,item_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?,?)").bind(id("PEV"),input.projectId,itemId,"ASSET_LINKED_TO_SLOT","FROZEN",JSON.stringify({assetId:input.assetId,itemKey,role:input.role||null}),ts).run().catch(()=>undefined);
  }
  return {ok:true,projectId:input.projectId,slotKey:"approved",assetId:input.assetId,itemId,idempotent};
}
