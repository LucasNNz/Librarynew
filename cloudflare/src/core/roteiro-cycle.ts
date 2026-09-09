import type { Env } from "../types";
import { id, nowMs, stableId } from "./ids";

const clean=(value:unknown)=>String(value??"").trim();
export type VisualStrategy="LIBRARY_ONLY"|"HYBRID";
export const visualStrategyForPosition=(position:number):VisualStrategy=>position<=3?"LIBRARY_ONLY":"HYBRID";
const nextPosition=(position:number)=>position>=5?1:position+1;

async function ensureCycleRow(env:Env){
  const ts=nowMs();
  await env.DB.prepare("INSERT OR IGNORE INTO v2_roteiro_cycle_state(id,next_position,updated_at) VALUES ('ROTEIRO',1,?)").bind(ts).run();
}

export async function getRoteiroCycleState(env:Env){
  await ensureCycleRow(env);
  const row=await env.DB.prepare("SELECT * FROM v2_roteiro_cycle_state WHERE id='ROTEIRO'").first<Record<string,unknown>>();
  const position=Math.max(1,Math.min(5,Number(row?.next_position||1)));
  return {cycle_position:position,visual_strategy:visualStrategyForPosition(position),reserved_project_id:clean(row?.reserved_project_id)||null,reserved_operation_id:clean(row?.reserved_operation_id)||null,reserved_at:row?.reserved_at==null?null:Number(row.reserved_at)};
}

/** Reserve the current cycle position without advancing it. Retry with the same operation/project is idempotent. */
export async function reserveRoteiroCycle(env:Env,input:{projectId:string;operationId:string}){
  await ensureCycleRow(env);
  const projectId=clean(input.projectId),operationId=clean(input.operationId);
  const current=await getRoteiroCycleState(env);
  if(current.reserved_project_id&&current.reserved_project_id!==projectId){
    return {error:"ROTEIRO_CYCLE_RESERVED",status:409,...current,instruction:"Finalize a criação + SCRIPT do projeto reservado antes de abrir o próximo giro."} as const;
  }
  const ts=nowMs();
  const changed=await env.DB.prepare(`UPDATE v2_roteiro_cycle_state SET reserved_project_id=?,reserved_operation_id=?,reserved_at=COALESCE(reserved_at,?),updated_at=? WHERE id='ROTEIRO' AND (reserved_project_id IS NULL OR reserved_project_id=?)`).bind(projectId,operationId,ts,ts,projectId).run();
  if(!Number(changed.meta.changes||0))return {error:"ROTEIRO_CYCLE_RESERVATION_CONFLICT",status:409,...await getRoteiroCycleState(env)} as const;
  const state=await getRoteiroCycleState(env);
  return {ok:true,...state,idempotent:current.reserved_project_id===projectId};
}

/** Advances only after SCRIPT was parsed into at least one production scene. */
export async function advanceRoteiroCycleAfterScript(env:Env,input:{projectId:string;sceneCount:number;scriptFileId?:string}){
  const projectId=clean(input.projectId);if(Number(input.sceneCount||0)<=0)return {advanced:false,reason:"SCRIPT_WITHOUT_SCENES"};
  await ensureCycleRow(env);
  const project=await env.DB.prepare("SELECT id,visual_strategy,cycle_position,roteiro_cycle_advanced_at FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return {error:"PROJECT_NOT_FOUND",status:404} as const;
  const position=Number(project.cycle_position||0);
  if(!position)return {advanced:false,reason:"PROJECT_NOT_USING_ROTEIRO_CYCLE"};
  const expectedStrategy=visualStrategyForPosition(position),currentStrategy=clean(project.visual_strategy) as VisualStrategy;
  if(currentStrategy&&currentStrategy!==expectedStrategy)return {error:"PROJECT_CYCLE_STRATEGY_MISMATCH",status:409,cycle_position:position,visual_strategy:currentStrategy,expected_strategy:expectedStrategy} as const;
  if(project.roteiro_cycle_advanced_at){const state=await getRoteiroCycleState(env);return {advanced:false,idempotent:true,already_advanced:true,project_id:projectId,completed_position:position,next_cycle_position:state.cycle_position,next_visual_strategy:state.visual_strategy};}
  const cycle=await getRoteiroCycleState(env);
  if(cycle.reserved_project_id!==projectId||cycle.cycle_position!==position)return {error:"ROTEIRO_CYCLE_NOT_RESERVED_FOR_PROJECT",status:409,project_id:projectId,project_cycle_position:position,...cycle} as const;
  const ts=nowMs(),next=nextPosition(position),eventId=await stableId("PEV",`${projectId}\nROTEIRO_CYCLE_ADVANCED\n${position}`,12);
  const batch=await env.DB.batch([
    env.DB.prepare(`UPDATE automatic_projects SET roteiro_cycle_advanced_at=?,visual_strategy=?,cycle_position=?,state_version=state_version+1,workflow_updated_at=?,updated_at=?
      WHERE id=? AND roteiro_cycle_advanced_at IS NULL AND cycle_position=?
        AND EXISTS(SELECT 1 FROM v2_roteiro_cycle_state WHERE id='ROTEIRO' AND next_position=? AND reserved_project_id=?)`)
      .bind(ts,expectedStrategy,position,ts,ts,projectId,position,position,projectId),
    env.DB.prepare("UPDATE v2_roteiro_cycle_state SET next_position=?,reserved_project_id=NULL,reserved_operation_id=NULL,reserved_at=NULL,updated_at=? WHERE id='ROTEIRO' AND next_position=? AND reserved_project_id=?").bind(next,ts,position,projectId),
    env.DB.prepare("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(eventId,projectId,"ROTEIRO_CYCLE_ADVANCED","OK",JSON.stringify({cycle_position:position,visual_strategy:expectedStrategy,next_cycle_position:next,next_visual_strategy:visualStrategyForPosition(next),script_file_id:input.scriptFileId||null,scene_count:Number(input.sceneCount)}),ts),
  ]);
  if(!Number(batch[0]?.meta?.changes||0)||!Number(batch[1]?.meta?.changes||0)){
    const after=await env.DB.prepare("SELECT roteiro_cycle_advanced_at FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
    if(after?.roteiro_cycle_advanced_at){const state=await getRoteiroCycleState(env);return {advanced:false,idempotent:true,already_advanced:true,project_id:projectId,completed_position:position,next_cycle_position:state.cycle_position,next_visual_strategy:state.visual_strategy};}
    return {error:"ROTEIRO_CYCLE_ADVANCE_CONFLICT",status:409,project_id:projectId,...await getRoteiroCycleState(env)} as const;
  }
  return {advanced:true,project_id:projectId,completed_position:position,visual_strategy:expectedStrategy,next_cycle_position:next,next_visual_strategy:visualStrategyForPosition(next),advanced_at:ts,event_id:eventId};
}

export async function releaseRoteiroCycleReservation(env:Env,projectId:string,reason="PROJECT_CREATION_ROLLBACK"){
  const ts=nowMs();const pid=clean(projectId);const result=await env.DB.prepare("UPDATE v2_roteiro_cycle_state SET reserved_project_id=NULL,reserved_operation_id=NULL,reserved_at=NULL,updated_at=? WHERE id='ROTEIRO' AND reserved_project_id=?").bind(ts,pid).run();
  if(Number(result.meta.changes||0))await env.DB.prepare("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,?,?,?,?)").bind(id("PEV"),pid,"ROTEIRO_CYCLE_RESERVATION_RELEASED","OK",JSON.stringify({reason}),ts).run().catch(()=>undefined);
  return {released:Number(result.meta.changes||0)>0};
}
