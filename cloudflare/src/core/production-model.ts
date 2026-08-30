import type { Env } from "../types";
import { id, nowMs, stableId } from "./ids";
import { projectWriteGuard } from "./project-workflow";
import { listProjectTagsFlat } from "./slot-tags";

const clean=(value:unknown)=>String(value??"").trim();
const upper=(value:unknown)=>clean(value).toUpperCase();
const RESOLVED_SLOT_STATES=new Set(["RESOLVED","FROZEN","APPROVED","COMPLETED"]);

export type ProductionSceneSeed={
  sceneKey:string;
  number:number;
  title?:string;
  universe?:string;
  subject?:string;
  concept?:string;
  reference?:string;
  scriptExcerpt?:string;
  preset?:string;
  context?:string;
  compositionClass?:string;
  slots:Array<{targetFile?:string|null;subject?:string;reference?:string;preset?:string;context?:string;compositionClass?:string}>;
};

function slug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"GENERIC";}
function subjectFromTarget(targetFile:string){
  const stem=clean(targetFile).replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"").replace(/^\d{1,4}[-_ ]+/,"");
  return stem.replace(/[-_]+/g," ").trim();
}
function poolKey(subject:string,reference:string){return `REF-${slug(subject||reference)}`;}

export async function productionModelCounts(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT active_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return {reference_pools_total:0,reference_pools_ready:0,production_scenes_total:0,production_scenes_ready:0,production_slots_total:0,production_slots_resolved:0,production_slots_with_target:0,production_slots_missing_target:0,complete:false};
  const version=Number(project.active_version||1);
  const [pools,scenes,slots]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status IN ('READY','COMPLETE','QA_COMPLETE') OR EXISTS (SELECT 1 FROM v2_production_slots ps WHERE ps.reference_pool_id=v2_reference_pools.id AND ps.asset_id IS NOT NULL) THEN 1 ELSE 0 END) ready FROM v2_reference_pools WHERE project_id=? AND version=?").bind(projectId,version),
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status IN ('READY','COMPLETE') THEN 1 ELSE 0 END) ready FROM v2_production_scenes WHERE project_id=? AND version=?").bind(projectId,version),
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN asset_id IS NOT NULL AND status IN ('RESOLVED','FROZEN','APPROVED','COMPLETED') THEN 1 ELSE 0 END) resolved,SUM(CASE WHEN target_file IS NOT NULL AND target_file<>'' THEN 1 ELSE 0 END) with_target,SUM(CASE WHEN target_file IS NULL OR target_file='' THEN 1 ELSE 0 END) missing_target FROM v2_production_slots WHERE project_id=? AND version=?").bind(projectId,version),
  ]);
  const row=(r:D1Result<Record<string,unknown>>)=>r.results?.[0]||{};
  const p=row(pools),s=row(scenes),sl=row(slots);
  const total=Number(sl.total||0),resolved=Number(sl.resolved||0);
  return {
    reference_pools_total:Number(p.total||0),reference_pools_ready:Number(p.ready||0),
    production_scenes_total:Number(s.total||0),production_scenes_ready:Number(s.ready||0),
    production_slots_total:total,production_slots_resolved:resolved,
    production_slots_with_target:Number(sl.with_target||0),production_slots_missing_target:Number(sl.missing_target||0),
    complete:total>0&&resolved>=total,
  };
}

export async function materializeProductionModel(env:Env,input:{projectId:string;version:number;scenes:ProductionSceneSeed[]}){
  const ts=nowMs();
  let scenesCreated=0,scenesUpdated=0,slotsCreated=0,slotsUpdated=0,poolsCreated=0,poolsUpdated=0;
  for(const scene of input.scenes){
    const sceneId=await stableId("PSCENE",`${input.projectId}\n${input.version}\n${scene.sceneKey}`,12);
    const sceneExists=await env.DB.prepare("SELECT id FROM v2_production_scenes WHERE project_id=? AND version=? AND scene_key=?").bind(input.projectId,input.version,scene.sceneKey).first();
    sceneExists?scenesUpdated++:scenesCreated++;
    await env.DB.prepare(`INSERT INTO v2_production_scenes(id,project_id,version,scene_key,scene_number,title,universe,subject,concept,semantic_reference,script_excerpt,preset,context,composition_class,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'READY',?,?)
      ON CONFLICT(project_id,version,scene_key) DO UPDATE SET scene_number=excluded.scene_number,title=excluded.title,universe=excluded.universe,subject=excluded.subject,concept=excluded.concept,semantic_reference=excluded.semantic_reference,script_excerpt=excluded.script_excerpt,preset=excluded.preset,context=excluded.context,composition_class=excluded.composition_class,status='READY',updated_at=excluded.updated_at`)
      .bind(sceneId,input.projectId,input.version,scene.sceneKey,scene.number,scene.title||scene.sceneKey,scene.universe||null,scene.subject||null,scene.concept||null,scene.reference||null,scene.scriptExcerpt||null,scene.preset||null,scene.context||null,scene.compositionClass||"CONTEXTUAL",ts,ts).run();

    const seeds=scene.slots;
    for(let i=0;i<seeds.length;i++){
      const seed=seeds[i]; const target=clean(seed.targetFile); const subject=clean(seed.subject)||subjectFromTarget(target)||clean(scene.subject)||clean(scene.title); const reference=clean(seed.reference)||clean(scene.reference)||subject;
      const key=poolKey(subject,reference); const poolId=await stableId("RPOOL",`${input.projectId}\n${input.version}\n${key}`,12);
      const existingPool=await env.DB.prepare("SELECT id FROM v2_reference_pools WHERE project_id=? AND version=? AND pool_key=?").bind(input.projectId,input.version,key).first();
      existingPool?poolsUpdated++:poolsCreated++;
      await env.DB.prepare(`INSERT INTO v2_reference_pools(id,project_id,version,pool_key,subject,universe,semantic_reference,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'PENDING',?,?) ON CONFLICT(project_id,version,pool_key) DO UPDATE SET subject=COALESCE(NULLIF(excluded.subject,''),v2_reference_pools.subject),universe=COALESCE(NULLIF(excluded.universe,''),v2_reference_pools.universe),semantic_reference=COALESCE(NULLIF(excluded.semantic_reference,''),v2_reference_pools.semantic_reference),updated_at=excluded.updated_at`)
        .bind(poolId,input.projectId,input.version,key,subject||null,scene.universe||null,reference||null,ts,ts).run();

      const slotKey=target?`SLOT-${slug(target)}`:`${scene.sceneKey}-SLOT-${String(i+1).padStart(2,"0")}`;
      const slotId=await stableId("PSLOT",`${input.projectId}\n${input.version}\n${slotKey}`,12);
      const existingSlot=await env.DB.prepare("SELECT id FROM v2_production_slots WHERE project_id=? AND version=? AND slot_key=?").bind(input.projectId,input.version,slotKey).first();
      existingSlot?slotsUpdated++:slotsCreated++;
      await env.DB.prepare(`INSERT INTO v2_production_slots(id,project_id,version,scene_id,slot_key,slot_index,target_file,subject,universe,semantic_reference,reference_pool_id,preset,context,composition_class,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNRESOLVED',?,?)
        ON CONFLICT(project_id,version,slot_key) DO UPDATE SET scene_id=excluded.scene_id,slot_index=excluded.slot_index,target_file=COALESCE(excluded.target_file,v2_production_slots.target_file),subject=COALESCE(NULLIF(excluded.subject,''),v2_production_slots.subject),universe=COALESCE(NULLIF(excluded.universe,''),v2_production_slots.universe),semantic_reference=COALESCE(NULLIF(excluded.semantic_reference,''),v2_production_slots.semantic_reference),reference_pool_id=excluded.reference_pool_id,preset=COALESCE(NULLIF(excluded.preset,''),v2_production_slots.preset),context=COALESCE(NULLIF(excluded.context,''),v2_production_slots.context),composition_class=COALESCE(NULLIF(excluded.composition_class,''),v2_production_slots.composition_class),updated_at=excluded.updated_at`)
        .bind(slotId,input.projectId,input.version,sceneId,slotKey,i+1,target||null,subject||null,scene.universe||null,reference||null,poolId,seed.preset||scene.preset||null,seed.context||scene.context||scene.scriptExcerpt||null,seed.compositionClass||scene.compositionClass||"CONTEXTUAL",ts,ts).run();
    }
  }
  const counts=await productionModelCounts(env,input.projectId);
  await env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId).run();
  return {scenesCreated,scenesUpdated,slotsCreated,slotsUpdated,poolsCreated,poolsUpdated,...counts};
}

export async function listProductionModel(env:Env,input:{projectId:string;limit?:number}){
  const project=await env.DB.prepare("SELECT active_version FROM automatic_projects WHERE id=?").bind(input.projectId).first<Record<string,unknown>>();
  if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const version=Number(project.active_version||1),limit=Math.max(1,Math.min(Number(input.limit||500),1000));
  const [scenes,slots,pools]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare("SELECT * FROM v2_production_scenes WHERE project_id=? AND version=? ORDER BY scene_number,created_at LIMIT ?").bind(input.projectId,version,limit),
    env.DB.prepare(`SELECT s.*,a.name asset_name,a.r2_key asset_r2_key,a.mime_type asset_mime_type FROM v2_production_slots s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=? AND s.version=? ORDER BY COALESCE((SELECT scene_number FROM v2_production_scenes sc WHERE sc.id=s.scene_id),999999),s.slot_index,s.created_at LIMIT ?`).bind(input.projectId,version,limit),
    env.DB.prepare("SELECT * FROM v2_reference_pools WHERE project_id=? AND version=? ORDER BY pool_key LIMIT ?").bind(input.projectId,version,limit),
  ]);
  const visualTags=await listProjectTagsFlat(env,input.projectId).catch(()=>[]);const bySlot=new Map<string,any[]>();for(const tag of visualTags as any[]){const key=String(tag.slot_id||"");const list=bySlot.get(key)||[];list.push(tag);bySlot.set(key,list);}
  const productionSlots=(slots.results||[]).map(slot=>{const merged=[...(bySlot.get(String(slot.id||""))||[]),...(bySlot.get(String(slot.slot_key||""))||[])];const seen=new Set<string>();return {...slot,tags:merged.filter((tag:any)=>{const key=String(tag.tag_key||tag.id||"");if(seen.has(key))return false;seen.add(key);return true;})};});
  return {project_id:input.projectId,version,counts:await productionModelCounts(env,input.projectId),reference_pools:pools.results||[],production_scenes:scenes.results||[],production_slots:productionSlots,slot_tags_total:(visualTags as any[]).length};
}


export type ProductionSlotSeed={
  slotId?:string;
  targetFile:string;
  sceneKey?:string;
  subject?:string;
  universe?:string;
  reference?:string;
  preset?:string;
  context?:string;
  compositionClass?:string;
  observation?:string;
};

export async function upsertProductionSlots(env:Env,input:{projectId:string;slots:ProductionSlotSeed[]}){
  const guard=await projectWriteGuard(env,input.projectId); if(!guard.ok)return guard;
  const project=guard.project as Record<string,unknown>,version=Number(project.active_version||1);
  const slots=(input.slots||[]).map(s=>({
    slotId:clean(s.slotId),targetFile:clean(s.targetFile),sceneKey:clean(s.sceneKey),subject:clean(s.subject),universe:clean(s.universe),
    reference:clean(s.reference),preset:clean(s.preset),context:clean(s.context),compositionClass:clean(s.compositionClass)||"CONTEXTUAL",observation:clean(s.observation),
  })).filter(s=>s.targetFile).slice(0,500);
  if(!slots.length)return {error:"NO_SLOTS",status:400} as const;
  const ts=nowMs(),results:Record<string,unknown>[]=[];
  for(let i=0;i<slots.length;i++){
    const s=slots[i];
    const scene=s.sceneKey?await env.DB.prepare("SELECT * FROM v2_production_scenes WHERE project_id=? AND version=? AND scene_key=? LIMIT 1").bind(input.projectId,version,s.sceneKey).first<Record<string,unknown>>():null;
    const subject=s.subject||subjectFromTarget(s.targetFile)||clean(scene?.subject);
    const universe=s.universe||clean(scene?.universe);
    const reference=s.reference||clean(scene?.semantic_reference)||subject;
    const key=poolKey(subject,reference),poolId=await stableId("RPOOL",`${input.projectId}\n${version}\n${key}`,12);
    await env.DB.prepare(`INSERT INTO v2_reference_pools(id,project_id,version,pool_key,subject,universe,semantic_reference,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'PENDING',?,?) ON CONFLICT(project_id,version,pool_key) DO UPDATE SET subject=COALESCE(NULLIF(excluded.subject,''),v2_reference_pools.subject),universe=COALESCE(NULLIF(excluded.universe,''),v2_reference_pools.universe),semantic_reference=COALESCE(NULLIF(excluded.semantic_reference,''),v2_reference_pools.semantic_reference),updated_at=excluded.updated_at`)
      .bind(poolId,input.projectId,version,key,subject||null,universe||null,reference||null,ts,ts).run();
    let existing=await env.DB.prepare("SELECT * FROM v2_production_slots WHERE project_id=? AND version=? AND (id=? OR target_file=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1").bind(input.projectId,version,s.slotId,s.targetFile,s.slotId).first<Record<string,unknown>>();
    const wasExisting=Boolean(existing);
    const slotKey=clean(existing?.slot_key)||`SLOT-${slug(s.targetFile)}`;
    const slotId=clean(existing?.id)||s.slotId||await stableId("PSLOT",`${input.projectId}\n${version}\n${slotKey}`,12);
    const sceneId=clean(scene?.id)||clean(existing?.scene_id)||null;
    const slotIndex=Number(existing?.slot_index||i+1);
    await env.DB.prepare(`INSERT INTO v2_production_slots(id,project_id,version,scene_id,slot_key,slot_index,target_file,subject,universe,semantic_reference,reference_pool_id,preset,context,composition_class,status,observation,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNRESOLVED',?,?,?)
      ON CONFLICT(project_id,version,slot_key) DO UPDATE SET scene_id=COALESCE(excluded.scene_id,v2_production_slots.scene_id),target_file=excluded.target_file,subject=COALESCE(NULLIF(excluded.subject,''),v2_production_slots.subject),universe=COALESCE(NULLIF(excluded.universe,''),v2_production_slots.universe),semantic_reference=COALESCE(NULLIF(excluded.semantic_reference,''),v2_production_slots.semantic_reference),reference_pool_id=excluded.reference_pool_id,preset=COALESCE(NULLIF(excluded.preset,''),v2_production_slots.preset),context=COALESCE(NULLIF(excluded.context,''),v2_production_slots.context),composition_class=COALESCE(NULLIF(excluded.composition_class,''),v2_production_slots.composition_class),observation=COALESCE(NULLIF(excluded.observation,''),v2_production_slots.observation),updated_at=excluded.updated_at`)
      .bind(slotId,input.projectId,version,sceneId,slotKey,slotIndex,s.targetFile,subject||null,universe||null,reference||null,poolId,s.preset||clean(scene?.preset)||null,s.context||clean(scene?.context)||null,s.compositionClass, s.observation||null,ts,ts).run();
    existing=await env.DB.prepare("SELECT * FROM v2_production_slots WHERE project_id=? AND version=? AND target_file=? LIMIT 1").bind(input.projectId,version,s.targetFile).first<Record<string,unknown>>();
    results.push({slot_id:existing?.id||slotId,target_file:s.targetFile,scene_key:s.sceneKey||null,created:!wasExisting});
  }
  const counts=await productionModelCounts(env,input.projectId);
  await env.DB.batch([
    env.DB.prepare("UPDATE automatic_projects SET state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,input.projectId),
    env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),input.projectId,"PRODUCTION_SLOTS_UPSERTED","OK",JSON.stringify({requested:slots.length,counts}),ts),
  ]);
  return {project_id:input.projectId,accepted:slots.length,results,counts,idempotent_by:"project_id+version+target_file"};
}

export async function assignAssetsToSlots(env:Env,input:{projectId:string;assignments:Array<{slotId?:string;targetFile:string;assetId:string;observation?:string}>}){
  const guard=await projectWriteGuard(env,input.projectId); if(!guard.ok)return guard;
  const project=guard.project as Record<string,unknown>,version=Number(project.active_version||1);
  const assignments=(input.assignments||[]).map(a=>({slotId:clean(a.slotId),targetFile:clean(a.targetFile),assetId:clean(a.assetId),observation:clean(a.observation)})).filter(a=>a.targetFile&&a.assetId).slice(0,500);
  if(!assignments.length)return {error:"NO_ASSIGNMENTS",status:400} as const;
  const assetIds=[...new Set(assignments.map(a=>a.assetId))]; const validAssets=new Set<string>();
  for(let offset=0;offset<assetIds.length;offset+=50){const chunk=assetIds.slice(offset,offset+50),ph=chunk.map(()=>"?").join(",");const rows=await env.DB.prepare(`SELECT id FROM assets WHERE id IN (${ph})`).bind(...chunk).all<{id:string}>();for(const row of rows.results||[])validAssets.add(String(row.id));}
  const results:Record<string,unknown>[]=[]; const touchedAssets=new Set<string>(); const ts=nowMs();
  for(const a of assignments){
    if(!validAssets.has(a.assetId)){results.push({target_file:a.targetFile,asset_id:a.assetId,error:"ASSET_NOT_FOUND"});continue;}
    let slot=await env.DB.prepare("SELECT * FROM v2_production_slots WHERE project_id=? AND version=? AND (id=? OR target_file=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1").bind(input.projectId,version,a.slotId,a.targetFile,a.slotId).first<Record<string,unknown>>();
    if(!slot){
      const slotKey=`SLOT-${slug(a.targetFile)}`,slotId=await stableId("PSLOT",`${input.projectId}\n${version}\n${slotKey}`,12),subject=subjectFromTarget(a.targetFile),key=poolKey(subject,subject),poolId=await stableId("RPOOL",`${input.projectId}\n${version}\n${key}`,12);
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO v2_reference_pools(id,project_id,version,pool_key,subject,semantic_reference,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'PENDING',?,?)").bind(poolId,input.projectId,version,key,subject,subject,ts,ts),
        env.DB.prepare("INSERT OR IGNORE INTO v2_production_slots(id,project_id,version,scene_id,slot_key,slot_index,target_file,subject,semantic_reference,reference_pool_id,composition_class,status,created_at,updated_at) VALUES (?,?,?,NULL,?,1,?,?,?,?, 'CONTEXTUAL','UNRESOLVED',?,?)").bind(slotId,input.projectId,version,slotKey,a.targetFile,subject,subject,poolId,ts,ts),
      ]);
      slot=await env.DB.prepare("SELECT * FROM v2_production_slots WHERE id=?").bind(slotId).first<Record<string,unknown>>();
    }
    if(!slot){results.push({target_file:a.targetFile,asset_id:a.assetId,error:"SLOT_UPSERT_FAILED"});continue;}
    await env.DB.prepare("UPDATE v2_production_slots SET asset_id=?,status='FROZEN',observation=?,updated_at=? WHERE id=?").bind(a.assetId,a.observation||null,ts,slot.id).run();
    const usageId=await stableId("USE",`PRODUCTION_SLOT\n${input.projectId}\n${String(slot.id)}\n${a.assetId}`,12);
    await env.DB.prepare(`INSERT OR IGNORE INTO asset_usage(id,asset_id,project,block,preset,slot,role,script_reference,note,status,used_at) VALUES (?,?,?,?,?,?,? ,?,?, 'Registrado',?)`)
      .bind(usageId,a.assetId,input.projectId,clean(slot.scene_id)||null,clean(slot.preset)||null,a.targetFile,"PRODUCTION_SLOT",clean(slot.context)||null,a.observation||null,ts).run().catch(()=>undefined);
    touchedAssets.add(a.assetId);results.push({slot_id:slot.id,target_file:a.targetFile,asset_id:a.assetId,status:"FROZEN"});
  }
  for(const assetId of touchedAssets)await env.DB.prepare("UPDATE assets SET use_count=(SELECT COUNT(*) FROM asset_usage WHERE asset_id=?),last_used_at=?,updated_at=? WHERE id=?").bind(assetId,ts,ts,assetId).run().catch(()=>undefined);
  await env.DB.prepare(`UPDATE v2_reference_pools SET status=CASE WHEN EXISTS (SELECT 1 FROM v2_production_slots ps WHERE ps.reference_pool_id=v2_reference_pools.id AND ps.asset_id IS NOT NULL) THEN 'READY' ELSE status END,updated_at=? WHERE project_id=? AND version=?`).bind(ts,input.projectId,version).run();
  const counts=await productionModelCounts(env,input.projectId);
  const pipeline=counts.complete?"SLOT_ASSIGNMENT_COMPLETE":"SLOT_ASSIGNMENT_WORKING";
  const nextAction=counts.complete?"GENERATE_PACKAGE":"ASSIGN_ASSETS_TO_SLOTS";
  await env.DB.batch([
    env.DB.prepare("UPDATE automatic_projects SET status='ACTIVE',pipeline_status=?,next_action=?,state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(pipeline,nextAction,ts,ts,input.projectId),
    env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),input.projectId,"PRODUCTION_SLOTS_ASSIGNED",pipeline,JSON.stringify({requested:assignments.length,assigned:results.filter(r=>!r.error).length,errors:results.filter(r=>r.error).length,counts}),ts),
  ]);
  return {accepted:assignments.length,assigned:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,results,counts,no_r2_copy:true,asset_relation:"ASSET_1_TO_N_PRODUCTION_SLOTS"};
}

export async function productionCompletionGate(env:Env,projectId:string){
  const counts=await productionModelCounts(env,projectId);
  const rows=await env.DB.prepare("SELECT id,type,status,file_name,created_at FROM v2_download_packages WHERE project_id=? AND type IN ('PROJECT_IMAGES_ZIP','PROJECT_SCRIPT_TXT','PROJECT_PUBLICATION_ZIP') ORDER BY created_at DESC LIMIT 30").bind(projectId).all<Record<string,unknown>>().catch(()=>({results:[]} as unknown as D1Result<Record<string,unknown>>));
  const latest=new Map<string,Record<string,unknown>>();for(const row of rows.results||[]){const type=upper(row.type);if(!latest.has(type))latest.set(type,row);}
  const ready=(type:string)=>["READY_FOR_DOWNLOAD","DOWNLOADED","COMPLETED"].includes(upper(latest.get(type)?.status));
  const artifacts={images:ready("PROJECT_IMAGES_ZIP"),script:ready("PROJECT_SCRIPT_TXT"),publication:ready("PROJECT_PUBLICATION_ZIP")};
  const packageReady=artifacts.images&&artifacts.script&&artifacts.publication;
  return {...counts,package_ready:packageReady,final_artifacts_ready:artifacts,package_status:packageReady?"READY_FOR_DOWNLOAD":"WAITING_FINAL_ARTIFACTS",package_id:latest.get("PROJECT_IMAGES_ZIP")?.id||null,can_complete:counts.production_slots_total>0&&counts.complete&&packageReady};
}
