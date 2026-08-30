import type { Env } from "../types";
import { id, nowMs, stableId } from "./ids";
import { materializeProductionModel, type ProductionSceneSeed } from "./production-model";

function clean(value: unknown){return String(value??"").trim();}

export type ParsedProjectScene = {
  itemKey:string;
  number:number;
  title:string;
  subject:string;
  universe:string;
  concept:string;
  reference:string;
  scriptExcerpt:string;
  preset:string;
  compositionClass:string;
  targetFiles:string[];
};

function stripMarkdown(value:string){
  return value.replace(/^\s{0,3}#{1,6}\s*/,"").replace(/^\s*[-*+]\s+/,"").trim();
}

function sceneHeader(line:string){
  const raw=stripMarkdown(line);
  const patterns=[
    /^\[\s*0*(\d{1,4})\s*\]\s*(?:[-–—:|]\s*)?(.*)$/i,
    /^(?:PERGUNTA|QUESTAO|QUESTÃO|QUESTION)\s*[-_:#]?\s*0*(\d{1,4})\s*(?:[-–—:|]\s*)?(.*)$/i,
    /^\[?\s*(?:CENA|SCENE)\s*[-_:#]?\s*0*(\d{1,4})\s*\]?\s*(?:[-–—:|]\s*(.*))?$/i,
    /^\[?\s*(CENA[-_ ]?0*\d{1,4})\s*\]?\s*(?:[-–—:|]\s*(.*))?$/i,
    /^(?:ID|SCENE_ID|CENA_ID)\s*[:=-]\s*\[?\s*(?:CENA|SCENE)?\s*[-_ ]?0*(\d{1,4})\s*\]?\s*(?:[-–—:|]\s*(.*))?$/i,
  ];
  for(const pattern of patterns){
    const match=raw.match(pattern);if(!match)continue;
    const numeric=Number((match[1]||"").replace(/\D/g,""));
    if(!Number.isFinite(numeric)||numeric<=0)continue;
    return {number:numeric,title:clean(match[2])};
  }
  return null;
}

function field(block:string,key:string){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const regex=new RegExp(`(?:^|\\n)\\s*(?:[-*+]\\s*)?(?:${escaped})\\s*[:=-]\\s*(.+)$`,`im`);
  return clean(block.match(regex)?.[1]);
}

function firstContentLine(block:string){
  for(const line of block.split(/\r?\n/)){
    const value=stripMarkdown(line);
    if(!value)continue;
    if(sceneHeader(value))continue;
    if(/^(?:UNIVERSO|UNIVERSE|SUJEITO|SUBJECT|CONCEITO|CONCEPT|REFER[EÊ]NCIA|REFERENCE|TRECHO|SCRIPT|ROTEIRO|PRESET|TIPO|TYPE)\s*[:=-]/i.test(value))continue;
    return value.slice(0,220);
  }
  return "";
}


function targetFilesFromBlock(block:string){
  const found:string[]=[];
  const seen=new Set<string>();
  const pattern=/\b([A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:jpe?g|png|webp|gif|avif))\b/gi;
  for(const match of block.matchAll(pattern)){
    const raw=clean(match[1]).replace(/\s+/g," ");
    if(!raw)continue;
    const normalized=raw.replace(/^["']|["']$/g,"");
    const key=normalized.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);found.push(normalized);
  }
  return found.slice(0,20);
}

export function parseProjectScriptScenes(content:string):ParsedProjectScene[]{
  const normalized=String(content??"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const lines=normalized.split("\n");
  const boundaries:Array<{index:number;number:number;title:string}> = [];
  for(let index=0;index<lines.length;index++){
    const header=sceneHeader(lines[index]);
    if(!header)continue;
    const previous=boundaries[boundaries.length-1];
    if(previous&&previous.number===header.number&&index-previous.index<=3){if(!previous.title&&header.title)previous.title=header.title;continue;}
    boundaries.push({index,...header});
  }
  if(!boundaries.length)return [];

  const scenes:ParsedProjectScene[]=[];
  const seen=new Set<string>();
  for(let cursor=0;cursor<boundaries.length;cursor++){
    const current=boundaries[cursor];
    const end=cursor+1<boundaries.length?boundaries[cursor+1].index:lines.length;
    const block=lines.slice(current.index,end).join("\n").trim();
    const itemKey=`CENA-${String(current.number).padStart(3,"0")}`;
    if(seen.has(itemKey))continue;
    seen.add(itemKey);
    const explicitTitle=current.title;
    const universe=field(block,"UNIVERSO")||field(block,"UNIVERSE");
    const subject=field(block,"SUJEITO")||field(block,"SUBJECT")||field(block,"PERSONAGEM")||field(block,"PERSONAGEM PRINCIPAL");
    const concept=field(block,"CONCEITO")||field(block,"CONCEPT")||field(block,"IMAGEM")||field(block,"VISUAL");
    const reference=field(block,"REFERÊNCIA")||field(block,"REFERENCIA")||field(block,"REFERENCE")||field(block,"REFERÊNCIA VISUAL")||field(block,"REFERENCIA VISUAL");
    const preset=field(block,"PRESET");
    const compositionClass=field(block,"COMPOSITION_CLASS")||field(block,"COMPOSICAO")||field(block,"COMPOSIÇÃO")||field(block,"TIPO")||"CONTEXTUAL";
    const targetFiles=targetFilesFromBlock(block);
    const inferred=firstContentLine(block);
    const title=explicitTitle||subject||concept||inferred||itemKey;
    scenes.push({
      itemKey,
      number:current.number,
      title,
      subject:subject||title,
      universe,
      concept:concept||title,
      reference:reference||concept||title,
      scriptExcerpt:block.slice(0,6000),
      preset,
      compositionClass,
      targetFiles,
    });
  }
  return scenes;
}

export async function materializeScenesFromProjectScript(env:Env,input:{projectId:string;content:string;fileId?:string;fileName?:string;productionOnly?:boolean}){
  const projectId=clean(input.projectId);
  const project=await env.DB.prepare("SELECT id,active_version,status,pipeline_status FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return {ok:false,error:"PROJECT_NOT_FOUND",status:404,sceneCount:0} as const;
  const scenes=parseProjectScriptScenes(input.content);
  const ts=nowMs();
  if(!scenes.length){
    await env.DB.batch([
      env.DB.prepare("UPDATE automatic_projects SET status=CASE WHEN status='WAITING_FILES' THEN 'ACTIVE' ELSE status END,pipeline_status='INTERPRETANDO_ROTEIRO',next_action='PARSE_SCRIPT',state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?").bind(ts,ts,projectId),
      env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SCRIPT_PARSE_NO_SCENES","ATTENTION",JSON.stringify({fileId:input.fileId||null,fileName:input.fileName||null,reason:"NO_SCENE_HEADERS_RECOGNIZED"}),ts),
    ]);
    return {ok:true,sceneCount:0,created:0,updated:0,projectStatus:"ACTIVE",pipelineStatus:"INTERPRETANDO_ROTEIRO",nextAction:"PARSE_SCRIPT",warning:"NO_SCENE_HEADERS_RECOGNIZED"};
  }

  if(input.productionOnly){
    const productionSeeds:ProductionSceneSeed[]=scenes.map(scene=>({sceneKey:scene.itemKey,number:scene.number,title:scene.title,universe:scene.universe,subject:scene.subject,concept:scene.concept,reference:scene.reference,scriptExcerpt:scene.scriptExcerpt,preset:scene.preset,context:scene.scriptExcerpt,compositionClass:scene.compositionClass,slots:scene.targetFiles.map(targetFile=>({targetFile,preset:scene.preset,context:scene.scriptExcerpt,compositionClass:scene.compositionClass}))}));
    const production=await materializeProductionModel(env,{projectId,version:Number(project.active_version||1),scenes:productionSeeds});
    await env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SCRIPT_PRODUCTION_RECONCILED","OK",JSON.stringify({fileId:input.fileId||null,fileName:input.fileName||null,sceneCount:scenes.length,productionOnly:true,production}),ts).run().catch(()=>undefined);
    return {ok:true,sceneCount:scenes.length,created:0,updated:0,production,productionOnly:true,projectStatus:project.status,pipelineStatus:project.pipeline_status,nextAction:null,items:scenes.map(scene=>({item_key:scene.itemKey,title:scene.title,universe:scene.universe||null,subject:scene.subject||null,target_files:scene.targetFiles}))};
  }

  let created=0,updated=0;
  const statements:D1PreparedStatement[]=[];
  for(const scene of scenes){
    const stableItemId=await stableId("PITEM",`PROJECT_SCRIPT_SCENE\n${projectId}\n${scene.itemKey}`,12);
    const strategyState=JSON.stringify({
      collectorConcept:scene.concept||undefined,
      collectorReference:scene.reference||undefined,
      collectorScriptExcerpt:scene.scriptExcerpt||undefined,
      collectorSubject:scene.subject||undefined,
      collectorUniverse:scene.universe||undefined,
      source:"SCRIPT_AUTO_PARSE",
      scriptFileId:input.fileId||undefined,
    });
    const exists=await env.DB.prepare("SELECT id FROM automatic_project_items WHERE id=? OR (project_id=? AND item_key=?) LIMIT 1").bind(stableItemId,projectId,scene.itemKey).first<Record<string,unknown>>();
    const itemId=exists?.id?String(exists.id):stableItemId;
    if(exists)updated++;else created++;
    statements.push(env.DB.prepare(`INSERT INTO automatic_project_items
      (id,project_id,version,item_key,term,context,kind,universe,status,priority,created_at,updated_at,target_candidates,required_approved,collection_status,qa_status,stage,semantic_reference,strategy_state,composition_class)
      VALUES (?,?,?,?,?,?,'contextual',?,'COLLECTING',1,?,?,8,1,'EMPTY','WAITING_COLLECTION','DISCOVERY',?,?,'CONTEXTUAL')
      ON CONFLICT(id) DO UPDATE SET
        term=excluded.term,
        context=excluded.context,
        universe=CASE WHEN COALESCE(excluded.universe,'')<>'' THEN excluded.universe ELSE automatic_project_items.universe END,
        semantic_reference=CASE WHEN COALESCE(excluded.semantic_reference,'')<>'' THEN excluded.semantic_reference ELSE automatic_project_items.semantic_reference END,
        strategy_state=excluded.strategy_state,
        status=CASE WHEN upper(automatic_project_items.status) IN ('PARSING','PENDING','WAITING_FILES') THEN 'COLLECTING' ELSE automatic_project_items.status END,
        updated_at=excluded.updated_at`)
      .bind(itemId,projectId,Number(project.active_version||1),scene.itemKey,scene.subject||scene.title,scene.scriptExcerpt,scene.universe||null,ts,ts,scene.reference||scene.concept||scene.title,strategyState));
  }
  for(let offset=0;offset<statements.length;offset+=50)await env.DB.batch(statements.slice(offset,offset+50));
  const productionSeeds:ProductionSceneSeed[]=scenes.map(scene=>({
    sceneKey:scene.itemKey,
    number:scene.number,
    title:scene.title,
    universe:scene.universe,
    subject:scene.subject,
    concept:scene.concept,
    reference:scene.reference,
    scriptExcerpt:scene.scriptExcerpt,
    preset:scene.preset,
    context:scene.scriptExcerpt,
    compositionClass:scene.compositionClass,
    slots:scene.targetFiles.map(targetFile=>({targetFile,preset:scene.preset,context:scene.scriptExcerpt,compositionClass:scene.compositionClass})),
  }));
  const production=await materializeProductionModel(env,{projectId,version:Number(project.active_version||1),scenes:productionSeeds});
  await env.DB.batch([
    env.DB.prepare(`UPDATE automatic_projects SET status='ACTIVE',pipeline_status='PROCESSANDO',next_action='DISPATCH',started_at=COALESCE(started_at,?),total_items=(SELECT COUNT(*) FROM automatic_project_items WHERE project_id=?),state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?`).bind(ts,projectId,ts,ts,projectId),
    env.DB.prepare("INSERT INTO automatic_project_events (id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),projectId,"SCRIPT_PARSED_SCENES","OK",JSON.stringify({fileId:input.fileId||null,fileName:input.fileName||null,sceneCount:scenes.length,created,updated,production,itemKeys:scenes.slice(0,200).map(scene=>scene.itemKey)}),ts),
  ]);
  return {ok:true,sceneCount:scenes.length,created,updated,production,projectStatus:"ACTIVE",pipelineStatus:"PROCESSANDO",nextAction:"DISPATCH",items:scenes.map(scene=>({item_key:scene.itemKey,title:scene.title,universe:scene.universe||null,subject:scene.subject||null,target_files:scene.targetFiles}))};
}
