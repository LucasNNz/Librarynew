import type { Env } from "../types";
import { nowMs, stableId } from "./ids";
import { productionModelCounts } from "./production-model";
import { quizRpc } from "../quiz/service";
import DEFAULT_QUIZ_PROJECT from "../quiz/default-project";

const clean=(value:unknown)=>String(value??"").trim();
const upper=(value:unknown)=>clean(value).toUpperCase();

async function sha256Hex(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}

export async function getProjectQuizPayload(env:Env,projectId:string){
  const project=await env.DB.prepare("SELECT id,name,active_version,visual_strategy,cycle_position,next_action,pipeline_status FROM automatic_projects WHERE id=?").bind(clean(projectId)).first<Record<string,unknown>>();
  if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const version=Number(project.active_version||1);
  const [scriptRow,titlesResult,scenesResult,slotsResult]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare("SELECT id,version,file_name,r2_key,mime_type,size_bytes,content_hash,created_at FROM automatic_project_files WHERE project_id=? AND upper(role)='SCRIPT' ORDER BY version DESC,created_at DESC LIMIT 1").bind(projectId),
    env.DB.prepare("SELECT id,text,status,selected,slot_index,agent_origin,created_at,updated_at FROM v2_project_titles WHERE project_id=? AND status NOT IN ('REJECTED','TITLE_REJECTED') ORDER BY COALESCE(slot_index,999),created_at,id LIMIT 3").bind(projectId),
    env.DB.prepare("SELECT id,scene_key,scene_number,title,universe,subject,concept,semantic_reference,script_excerpt,preset,context,composition_class,status,created_at,updated_at FROM v2_production_scenes WHERE project_id=? AND version=? AND status<>'RETIRED' ORDER BY scene_number,created_at,id").bind(projectId,version),
    env.DB.prepare("SELECT id AS slot_id,scene_id,slot_key,slot_index,target_file,subject,universe,semantic_reference AS reference,preset,context,composition_class,visual_role,status,asset_id,assignment_source,qa_finalized_at,updated_at FROM v2_production_slots WHERE project_id=? AND version=? AND status<>'RETIRED' ORDER BY COALESCE((SELECT scene_number FROM v2_production_scenes sc WHERE sc.id=v2_production_slots.scene_id),999999),slot_index,created_at,id").bind(projectId,version),
  ]);
  const script=scriptRow.results?.[0]||null;let scriptContent:string|null=null;
  if(script?.r2_key){const object=await env.MEDIA.get(clean(script.r2_key));if(object)scriptContent=await object.text();}
  const titles=(titlesResult.results||[]).map(row=>({title_id:clean(row.id),texto:clean(row.text),slot_index:row.slot_index==null?null:Number(row.slot_index),selected:Boolean(Number(row.selected||0)),status:clean(row.status),agent_origin:clean(row.agent_origin)||null}));
  const scenes:Record<string,unknown>[]=scenesResult.results||[];
  const slots:Record<string,unknown>[]=(slotsResult.results||[]).map((row:Record<string,unknown>)=>({...row,asset_id:clean(row.asset_id)||null}));
  const presets=[...new Set([...scenes.map(r=>clean(r.preset)),...slots.map(r=>clean(r.preset))].filter(Boolean))];
  const counts=await productionModelCounts(env,projectId);
  const missingFinalAssets=slots.filter(row=>upper(row.status)!=="FROZEN"||!clean(row.asset_id)).map(row=>({slot_id:row.slot_id,target_file:row.target_file,status:row.status,asset_id:row.asset_id||null}));
  const blockers:string[]=[];if(!scriptContent)blockers.push("SCRIPT_MISSING");if(titles.length<3)blockers.push("THREE_TITLES_REQUIRED");if(!scenes.length)blockers.push("SCENES_MISSING");if(missingFinalAssets.length)blockers.push("FINAL_ASSETS_PENDING");if(!counts.complete)blockers.push("QA_NOT_COMPLETE");
  const payload={project:{project_id:clean(project.id),nome:clean(project.name),visual_strategy:clean(project.visual_strategy)||null,cycle_position:project.cycle_position==null?null:Number(project.cycle_position),active_version:version},script:script?{file_id:clean(script.id),version:Number(script.version||1),file_name:clean(script.file_name),content_hash:clean(script.content_hash)||null,content:scriptContent}:null,titles,scenes,presets,slots,counts,ready_for_quiz:blockers.length===0,blockers,missing_final_assets:missingFinalAssets};
  return {...payload,payload_hash:await sha256Hex(JSON.stringify(payload))};
}

function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value));}
function assetRole(slot:any,index:number){const role=upper(slot.visual_role).replace(/^IMAGE/,"IMAGEM");if(/(?:^|_)A$/.test(role))return "a";if(/(?:^|_)B$/.test(role))return "b";if(/(?:^|_)C$/.test(role))return "c";if(/(?:^|_)D$/.test(role))return "d";const n=Number(role.match(/(?:_|)([1-4])$/)?.[1]||0);if(n)return ["a","b","c","d"][n-1];if(role.includes("BACKGROUND")||role.includes("FUNDO"))return "background";return index<4?["a","b","c","d"][index]:`overlay${index-4}`;}

export function quizProjectFromPayload(payload:any){
  const base:any=clone(DEFAULT_QUIZ_PROJECT as any),template:any=base.scenes[0],byScene=new Map<string,any[]>();
  for(const slot of payload.slots||[]){const key=clean(slot.scene_id);const list=byScene.get(key)||[];list.push(slot);byScene.set(key,list);}
  const scenes=(payload.scenes||[]).map((source:any,sceneIndex:number)=>{
    const scene:any=clone(template);scene.title=clean(source.title)||clean(source.subject)||`CENA ${sceneIndex+1}`;scene.sceneNumber=String(Number(source.scene_number||sceneIndex+1)).padStart(2,"0");scene.format="16:9";scene.layoutFormat="16:9";scene.corvo_meta={scene_id:source.id,scene_key:source.scene_key,universe:source.universe||null,subject:source.subject||null,reference:source.semantic_reference||null,preset:source.preset||null,context:source.context||null};
    for(const k of ["a","b","c","d"]){scene[k].assetId="";scene[k].imageUrl="";scene[k].image=null;scene[k].visible=false;}
    for(const overlay of scene.overlays||[]){overlay.assetId="";overlay.imageUrl="";overlay.image=null;}
    scene.backgroundAssetId="";scene.backgroundUrl="";scene.background=null;
    const sceneSlots=byScene.get(clean(source.id))||[];let overlayCursor=0;
    sceneSlots.forEach((slot:any,i:number)=>{const assetId=clean(slot.asset_id);if(!assetId)return;const role=assetRole(slot,i);const label=clean(slot.subject)||clean(slot.reference)||clean(slot.target_file)||`Imagem ${i+1}`;
      if(["a","b","c","d"].includes(role)){scene[role].assetId=assetId;scene[role].imageUrl="";scene[role].image=null;scene[role].visible=true;scene[role].label=label;return;}
      if(role==="background"){scene.backgroundAssetId=assetId;scene.backgroundUrl="";scene.background=null;return;}
      const n=role.startsWith("overlay")?Number(role.slice(7)):overlayCursor++;if(Number.isInteger(n)&&n>=0&&n<3){scene.overlays[n].assetId=assetId;scene.overlays[n].imageUrl="";scene.overlays[n].image=null;scene.overlays[n].name=label;}
    });
    return scene;
  });
  return {...base,active_scene:1,selected_scenes:[],scenes:scenes.length?scenes:[template],corvo_import:{project_id:payload.project?.project_id,payload_hash:payload.payload_hash,titles:payload.titles,presets:payload.presets,script_file_id:payload.script?.file_id||null,imported_at:new Date().toISOString()}};
}

async function automaticQuizDocument(env:Env,request:Request,projectId:string,title:string){
  const existing=await env.DB.prepare("SELECT id,revision FROM quiz_documents WHERE project_id=? ORDER BY updated_at DESC,id LIMIT 1").bind(projectId).first<Record<string,unknown>>();
  if(existing)return {id:clean(existing.id),revision:Number(existing.revision||1),created:false};
  const quizId=await stableId("QUIZ",`PROJECT\n${projectId}`,12);const created=await quizRpc(env,request,"create",{id:quizId,project_id:projectId,title:`${title} — Quiz`});return {id:clean(created.id),revision:Number(created.revision||1),created:true};
}

async function renderState(env:Env,projectId:string){return env.DB.prepare("SELECT * FROM v2_project_quiz_render WHERE project_id=?").bind(projectId).first<Record<string,unknown>>();}
async function jobState(env:Env,request:Request,jobId:string){return quizRpc(env,request,"job",{job_id:jobId});}

export async function processQuizRenderProject(env:Env,request:Request,input:{projectId?:string}){
  let projectId=clean(input.projectId);
  if(!projectId){const row=await env.DB.prepare("SELECT id FROM automatic_projects WHERE COALESCE(lifecycle_status,'ACTIVE')='ACTIVE' AND next_action='QUIZ_RENDER' ORDER BY queue_priority DESC,updated_at ASC,id ASC LIMIT 1").first<Record<string,unknown>>();projectId=clean(row?.id);}
  if(!projectId)return {ok:true,processed:false,reason:"NO_QUIZ_RENDER_PROJECT"};
  const project=await env.DB.prepare("SELECT id,name,next_action,pipeline_status FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  if(upper(project.next_action)!=="QUIZ_RENDER")return {error:"PROJECT_NOT_QUIZ_RENDER",status:409,project_id:projectId,next_action:project.next_action} as const;
  const payload:any=await getProjectQuizPayload(env,projectId);if(payload.error)return payload;if(!payload.ready_for_quiz)return {ok:true,processed:false,project_id:projectId,next_action:"QUIZ_RENDER",retry:true,blockers:payload.blockers,missing_final_assets:payload.missing_final_assets};
  const quiz=await automaticQuizDocument(env,request,projectId,clean(project.name)||projectId),ts=nowMs();let state=await renderState(env,projectId);
  if(!state){await env.DB.prepare("INSERT INTO v2_project_quiz_render(project_id,quiz_id,payload_hash,status,attempt,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)").bind(projectId,quiz.id,payload.payload_hash,ts,ts).run();state=await renderState(env,projectId);}
  if(clean(state?.payload_hash)!==payload.payload_hash&&upper(state?.status)!=="VIDEO_READY"){
    await env.DB.prepare("UPDATE v2_project_quiz_render SET quiz_id=?,payload_hash=?,import_job_id=NULL,render_job_id=NULL,status='PENDING',attempt=attempt+1,video_url=NULL,last_error=NULL,updated_at=?,completed_at=NULL WHERE project_id=?").bind(quiz.id,payload.payload_hash,ts,projectId).run();state=await renderState(env,projectId);
  }
  if(upper(state?.status)==="VIDEO_READY"){
    const url=clean(state?.video_url)||null;await env.DB.prepare("UPDATE automatic_projects SET pipeline_status='VIDEO_READY',next_action='VIDEO_READY',workflow_updated_at=?,updated_at=? WHERE id=? AND next_action='QUIZ_RENDER'").bind(ts,ts,projectId).run();return {ok:true,processed:true,idempotent:true,project_id:projectId,quiz_id:quiz.id,status:"VIDEO_READY",video_url:url};
  }
  const attempt=Number(state?.attempt||0);
  if(upper(state?.status)==="IMPORTING"&&clean(state?.import_job_id)){
    const job=await jobState(env,request,clean(state?.import_job_id));
    if(["QUEUED","RUNNING","CANCEL_REQUESTED"].includes(upper(job.status)))return {ok:true,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"IMPORTING",job_id:job.id,status:job.status,next_action:"QUIZ_RENDER"};
    if(upper(job.status)!=="SUCCEEDED"){
      await env.DB.prepare("UPDATE v2_project_quiz_render SET status='PENDING',attempt=attempt+1,import_job_id=NULL,render_job_id=NULL,last_error=?,updated_at=? WHERE project_id=?").bind(JSON.stringify(job.result||{status:job.status}),ts,projectId).run();return {ok:false,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"IMPORT_FAILED",retry:true,next_action:"QUIZ_RENDER",job};
    }
    await env.DB.prepare("UPDATE v2_project_quiz_render SET status='IMPORTED',last_error=NULL,updated_at=? WHERE project_id=?").bind(ts,projectId).run();state=await renderState(env,projectId);
  }
  if(upper(state?.status)==="RENDERING"&&clean(state?.render_job_id)){
    const job=await jobState(env,request,clean(state?.render_job_id));
    if(["QUEUED","RUNNING","CANCEL_REQUESTED"].includes(upper(job.status)))return {ok:true,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"RENDERING",job_id:job.id,status:job.status,next_action:"QUIZ_RENDER"};
    if(upper(job.status)!=="SUCCEEDED"){
      await env.DB.prepare("UPDATE v2_project_quiz_render SET status='IMPORTED',attempt=attempt+1,render_job_id=NULL,last_error=?,updated_at=? WHERE project_id=?").bind(JSON.stringify(job.result||{status:job.status}),ts,projectId).run();return {ok:false,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"RENDER_FAILED",retry:true,next_action:"QUIZ_RENDER",job};
    }
    const videoUrl=clean(job.result?.download_url);if(!videoUrl){await env.DB.prepare("UPDATE v2_project_quiz_render SET status='IMPORTED',attempt=attempt+1,render_job_id=NULL,last_error='MP4_URL_MISSING',updated_at=? WHERE project_id=?").bind(ts,projectId).run();return {ok:false,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"RENDER_FAILED",error:"MP4_URL_MISSING",retry:true,next_action:"QUIZ_RENDER"};}
    const eventId=await stableId("PEV",`${projectId}\nVIDEO_READY\n${payload.payload_hash}`,12);await env.DB.batch([
      env.DB.prepare("UPDATE v2_project_quiz_render SET status='VIDEO_READY',video_url=?,last_error=NULL,updated_at=?,completed_at=? WHERE project_id=?").bind(videoUrl,ts,ts,projectId),
      env.DB.prepare("UPDATE automatic_projects SET pipeline_status='VIDEO_READY',next_action='VIDEO_READY',state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=? AND next_action='QUIZ_RENDER'").bind(ts,ts,projectId),
      env.DB.prepare("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES(?,?,?,?,?,?)").bind(eventId,projectId,"QUIZ_RENDER_SUCCEEDED","VIDEO_READY",JSON.stringify({quiz_id:quiz.id,render_job_id:job.id,video_url:videoUrl,payload_hash:payload.payload_hash}),ts),
    ]);return {ok:true,processed:true,project_id:projectId,quiz_id:quiz.id,status:"VIDEO_READY",next_action:"VIDEO_READY",video_url:videoUrl,job_id:job.id};
  }
  state=await renderState(env,projectId);const current=upper(state?.status);
  if(current==="IMPORTED"){
    const requestId=`render-${projectId}-${payload.payload_hash.slice(0,12)}-${Number(state?.attempt||0)}`.slice(0,100);const submitted=await quizRpc(env,request,"execute",{id:quiz.id,request_id:requestId,command:{op:"export_project_mp4",format:"16:9"}});await env.DB.prepare("UPDATE v2_project_quiz_render SET render_job_id=?,status='RENDERING',updated_at=? WHERE project_id=?").bind(submitted.id,ts,projectId).run();return {ok:true,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"RENDER_SUBMITTED",job_id:submitted.id,deduplicated:Boolean(submitted.deduplicated),next_action:"QUIZ_RENDER"};
  }
  const snapshot=quizProjectFromPayload(payload),requestId=`import-${projectId}-${payload.payload_hash.slice(0,12)}-${Number(state?.attempt||0)}`.slice(0,100);const submitted=await quizRpc(env,request,"execute",{id:quiz.id,request_id:requestId,command:{op:"replace_project",project:snapshot}});await env.DB.prepare("UPDATE v2_project_quiz_render SET quiz_id=?,payload_hash=?,import_job_id=?,status='IMPORTING',updated_at=? WHERE project_id=?").bind(quiz.id,payload.payload_hash,submitted.id,ts,projectId).run();return {ok:true,processed:true,project_id:projectId,quiz_id:quiz.id,phase:"IMPORT_SUBMITTED",job_id:submitted.id,deduplicated:Boolean(submitted.deduplicated),next_action:"QUIZ_RENDER"};
}
