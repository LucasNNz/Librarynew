import type { Env } from "../types";
import { createSignedSupervisorCandidateUrl } from "./auth";
import { id, nowMs } from "./ids";
import { reconcileAutomaticProject } from "./projects";
import { recordRuntimeHeartbeat } from "./heartbeats";

const parseJson=(value:unknown,fallback:unknown={})=>{try{return JSON.parse(String(value??""))}catch{return fallback}};
const boolValue=(value:unknown)=>String(value).toLowerCase()==="true"||String(value)==="1";
const safeInt=(value:unknown,fallback:number)=>{const n=Number(value);return Number.isFinite(n)?Math.trunc(n):fallback};

const SUPERVISOR_SETTING_KEYS = new Set([
  "supervisor_mcp_enabled","supervisor_lease_ttl_minutes","supervisor_watchdog_interval_minutes","supervisor_renew_on_activity",
  "supervisor_auto_mark_abandoned","supervisor_auto_ready_for_resume","supervisor_reconcile_before_resume","supervisor_require_execution_id_for_writes",
  "supervisor_allow_old_execution_writes","supervisor_plan_max_parallelism","supervisor_plan_max_wip","supervisor_plan_packet_size",
  "supervisor_plan_candidate_buffer_min","supervisor_plan_candidate_buffer_target","supervisor_default_source_profile","supervisor_plan_policy_version"
]);

async function settings(env:Env,prefix="supervisor_"){
  const rows=await env.DB.prepare("SELECT key,value,updated_at FROM settings WHERE key LIKE ? ORDER BY key").bind(`${prefix}%`).all<{key:string;value:string;updated_at:number}>();
  return Object.fromEntries((rows.results||[]).map(row=>[row.key,row.value]));
}

export async function supervisorStatus(env:Env){
  const cfg=await settings(env);
  const [projects,executions,decisions]=await env.DB.batch([
    env.DB.prepare("SELECT supervisor_status,COUNT(*) AS count FROM automatic_projects GROUP BY supervisor_status"),
    env.DB.prepare("SELECT status,COUNT(*) AS count FROM supervisor_executions GROUP BY status"),
    env.DB.prepare("SELECT state,COUNT(*) AS count FROM supervisor_decision_queue GROUP BY state")
  ]);
  return {enabled:boolValue(cfg.supervisor_mcp_enabled??"true"),settings:cfg,projects:projects.results||[],executions:executions.results||[],decisions:decisions.results||[]};
}

export async function configureSupervisor(env:Env,input:Record<string,unknown>){
  const ts=nowMs(); const changed:Array<{key:string;previous:string|null;next:string}>=[];
  for(const [key,value] of Object.entries(input)){
    if(!SUPERVISOR_SETTING_KEYS.has(key)||value===undefined)continue;
    const previous=await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{value:string}>();
    const next=typeof value==="string"?value:typeof value==="boolean"?(value?"true":"false"):String(value);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,next,ts),
      env.DB.prepare("INSERT INTO supervisor_config_events (id,action,key,previous_value,next_value,source,reason,created_at) VALUES (?,?,?,?,?,'SUPERVISOR_MCP','V2_SAFE_CONFIG',?)").bind(id("SCFG"),"SET",key,previous?.value??null,next,ts)
    ]);
    changed.push({key,previous:previous?.value??null,next});
  }
  return {changed,settings:await settings(env)};
}

export async function claimNextSupervisorWork(env:Env,input:{workerId?:string;projectId?:string;leaseMinutes?:number}={}){
  const cfg=await settings(env); const ttl=Math.max(1,Math.min(input.leaseMinutes||safeInt(cfg.supervisor_lease_ttl_minutes,10),120)); const ts=nowMs(),expires=ts+ttl*60_000;
  const where=input.projectId?"id=? AND ":""; const args:unknown[]=input.projectId?[input.projectId]:[];
  const project=await env.DB.prepare(`SELECT * FROM automatic_projects WHERE ${where}status NOT IN ('COMPLETED','CANCELLED') AND (supervisor_lease_expires_at IS NULL OR supervisor_lease_expires_at<? OR supervisor_status IN ('LIVRE','ABANDONADO')) ORDER BY queue_priority DESC,COALESCE(ready_at,created_at) ASC LIMIT 1`).bind(...args,ts).first<Record<string,unknown>>();
  if(!project)return {claimed:false,reason:"NO_AVAILABLE_PROJECT"};
  const executionId=id("SEXE"); const previous=project.supervisor_execution_id?String(project.supervisor_execution_id):null;
  const update=await env.DB.prepare("UPDATE automatic_projects SET supervisor_execution_id=?,previous_execution_id=?,supervisor_lease_started_at=?,supervisor_last_seen_at=?,supervisor_lease_expires_at=?,supervisor_status='ATIVO',resume_reason=?,resumed_at=?,updated_at=updated_at,state_version=state_version+1 WHERE id=? AND (supervisor_lease_expires_at IS NULL OR supervisor_lease_expires_at<? OR supervisor_status IN ('LIVRE','ABANDONADO')) RETURNING *")
    .bind(executionId,previous,ts,ts,expires,input.workerId?`CLAIM:${input.workerId}`:"CLAIM_MCP",ts,project.id,ts).first<Record<string,unknown>>();
  if(!update)return {claimed:false,reason:"LEASE_RACE_LOST"};
  await env.DB.prepare("INSERT INTO supervisor_executions (id,project_id,previous_execution_id,status,lease_started_at,last_seen_at,lease_expires_at,resume_reason,created_at,updated_at) VALUES (?,?,?,'ATIVO',?,?,?,?,?,?)")
    .bind(executionId,project.id,previous,ts,ts,expires,input.workerId?`CLAIM:${input.workerId}`:"CLAIM_MCP",ts,ts).run();
  await recordRuntimeHeartbeat(env,{scopeType:"SUPERVISOR",scopeId:String(project.id),ownerId:input.workerId||"SUPERVISOR_MCP",executionId,ttlSeconds:ttl*60,metadata:{projectId:project.id}});
  if(boolValue(cfg.supervisor_reconcile_before_resume??"true")) await reconcileAutomaticProject(env,String(project.id));
  return {claimed:true,executionId,leaseExpiresAt:expires,project:update};
}

export async function heartbeatSupervisor(env:Env,input:{projectId:string;executionId:string;ownerId?:string;leaseMinutes?:number}){
  const cfg=await settings(env); const ttl=Math.max(1,Math.min(input.leaseMinutes||safeInt(cfg.supervisor_lease_ttl_minutes,10),120));
  const ts=nowMs(),expires=ts+ttl*60_000,ownerId=input.ownerId||"SUPERVISOR_MCP";
  const current=await env.DB.prepare("SELECT * FROM supervisor_executions WHERE id=? AND project_id=?").bind(input.executionId,input.projectId).first<Record<string,unknown>>();
  if(!current)return {error:"SUPERVISOR_EXECUTION_NOT_FOUND",status:404} as const;
  if(String(current.status)!=="ATIVO")return {error:"SUPERVISOR_LEASE_NOT_ACTIVE",currentStatus:current.status,status:409} as const;
  if(Number(current.lease_expires_at||0)<ts)return {error:"SUPERVISOR_LEASE_EXPIRED",leaseExpiresAt:current.lease_expires_at,status:409} as const;
  const runtime=await env.DB.prepare("SELECT owner_id,execution_id,lease_expires_at,status FROM v2_runtime_heartbeats WHERE scope_type='SUPERVISOR' AND scope_id=?").bind(input.projectId).first<Record<string,unknown>>();
  if(runtime && String(runtime.status)==="ACTIVE" && Number(runtime.lease_expires_at||0)>=ts && (String(runtime.owner_id)!==ownerId || String(runtime.execution_id)!==input.executionId))
    return {error:"SUPERVISOR_HEARTBEAT_OWNED_BY_ANOTHER_EXECUTION",ownerId:runtime.owner_id,executionId:runtime.execution_id,leaseExpiresAt:runtime.lease_expires_at,status:409} as const;
  const results=await env.DB.batch([
    env.DB.prepare("UPDATE supervisor_executions SET last_seen_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND project_id=? AND status='ATIVO' AND lease_expires_at>=?").bind(ts,expires,ts,input.executionId,input.projectId,ts),
    env.DB.prepare("UPDATE automatic_projects SET supervisor_last_seen_at=?,supervisor_lease_expires_at=?,last_action='HEARTBEAT',state_version=state_version+1,updated_at=? WHERE id=? AND supervisor_execution_id=? AND supervisor_status='ATIVO' AND supervisor_lease_expires_at>=?").bind(ts,expires,ts,input.projectId,input.executionId,ts),
  ]);
  const changedA=Number(results[0]?.meta?.changes||0),changedB=Number(results[1]?.meta?.changes||0);
  if(changedA!==1||changedB!==1)return {error:"SUPERVISOR_LEASE_STATE_INCONSISTENT",executionUpdated:changedA,projectUpdated:changedB,status:409} as const;
  await recordRuntimeHeartbeat(env,{scopeType:"SUPERVISOR",scopeId:input.projectId,ownerId,executionId:input.executionId,ttlSeconds:ttl*60,metadata:{projectId:input.projectId}});
  return {ok:true,projectId:input.projectId,ownerId,executionId:input.executionId,lastSeenAt:ts,leaseExpiresAt:expires,remainingMs:expires-ts,ttlMinutes:ttl,status:200} as const;
}

export async function supervisorWatchdog(env:Env){
  const ts=nowMs();
  const expired=await env.DB.prepare("SELECT id,project_id FROM supervisor_executions WHERE status='ATIVO' AND lease_expires_at<?").bind(ts).all<{id:string;project_id:string}>();
  const rows=expired.results||[];
  for(const row of rows){
    await env.DB.batch([
      env.DB.prepare("UPDATE supervisor_executions SET status='ABANDONADO',abandoned_at=?,updated_at=? WHERE id=? AND status='ATIVO'").bind(ts,ts,row.id),
      env.DB.prepare("UPDATE automatic_projects SET supervisor_status='ABANDONADO',abandoned_at=?,supervisor_execution_id=NULL,supervisor_lease_expires_at=NULL,updated_at=updated_at,state_version=state_version+1 WHERE id=? AND supervisor_execution_id=?").bind(ts,row.project_id,row.id),
      env.DB.prepare("UPDATE v2_runtime_heartbeats SET status='EXPIRED',updated_at=? WHERE scope_type='SUPERVISOR' AND scope_id=? AND execution_id=? AND status='ACTIVE'").bind(ts,row.project_id,row.id)
    ]);
  }
  return {expired:rows.length,executionIds:rows.map(r=>r.id)};
}

export async function supervisorLeaseTelemetry(env:Env){
  const ts=nowMs(); const [active,expired,recent]=await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count,MIN(lease_expires_at) AS next_expiry FROM supervisor_executions WHERE status='ATIVO' AND lease_expires_at>=?").bind(ts),
    env.DB.prepare("SELECT COUNT(*) AS count FROM supervisor_executions WHERE status='ATIVO' AND lease_expires_at<?").bind(ts),
    env.DB.prepare("SELECT * FROM supervisor_executions ORDER BY updated_at DESC LIMIT 50")
  ]);
  return {active:active.results?.[0]||{},expired:expired.results?.[0]||{},recent:recent.results||[],now:ts};
}

export async function backfillLegacyProjects(env:Env,limit=50){
  const rows=await env.DB.prepare("SELECT id FROM automatic_projects ORDER BY created_at ASC LIMIT ?").bind(Math.max(1,Math.min(limit,500))).all<{id:string}>(); const results:unknown[]=[];
  for(const row of rows.results||[])results.push(await reconcileAutomaticProject(env,row.id));
  return {processed:results.length,results};
}

export async function supervisorPanel(env:Env,projectId?:string){
  const [status,leases,decisions,candidates]=await Promise.all([
    supervisorStatus(env),supervisorLeaseTelemetry(env),listSupervisorDecisions(env,{projectId,state:"PENDENTE",limit:100}),listSupervisorCandidates(env,{projectId,status:"PARA_ANALISE",limit:100})
  ]);
  return {status,leases,pendingDecisions:decisions,pendingCandidates:candidates};
}

export async function listSupervisorDecisions(env:Env,input:{projectId?:string;state?:string;type?:string;limit?:number}){
  const where:string[]=["(q.item_id IS NULL OR EXISTS (SELECT 1 FROM automatic_project_items i WHERE i.id=q.item_id))","(q.project_id IS NULL OR EXISTS (SELECT 1 FROM automatic_projects p WHERE p.id=q.project_id))"];const values:unknown[]=[];
  if(input.projectId){where.push("q.project_id=?");values.push(input.projectId)}if(input.state){where.push("q.state=?");values.push(input.state)}if(input.type){where.push("q.type=?");values.push(input.type)}values.push(Math.max(1,Math.min(input.limit||100,500)));
  const rows=await env.DB.prepare(`SELECT q.* FROM supervisor_decision_queue q WHERE ${where.join(" AND ")} ORDER BY q.priority DESC,q.created_at ASC LIMIT ?`).bind(...values).all<Record<string,unknown>>();return rows.results||[];
}

export async function resolveSupervisorDecision(env:Env,decisionId:string,input:{decision:string;observation?:string}){
  const current=await env.DB.prepare("SELECT q.*,CASE WHEN q.item_id IS NULL OR EXISTS (SELECT 1 FROM automatic_project_items i WHERE i.id=q.item_id) THEN 1 ELSE 0 END AS item_valid,CASE WHEN q.project_id IS NULL OR EXISTS (SELECT 1 FROM automatic_projects p WHERE p.id=q.project_id) THEN 1 ELSE 0 END AS project_valid FROM supervisor_decision_queue q WHERE q.id=?").bind(decisionId).first<Record<string,unknown>>();
  if(!current)return null;
  if(Number(current.item_valid)!==1||Number(current.project_valid)!==1)return {error:"HISTORICAL_ORPHAN_IGNORED",decisionId,itemId:current.item_id||null,projectId:current.project_id||null};
  const ts=nowMs(); const result=await env.DB.prepare("UPDATE supervisor_decision_queue SET state='RESOLVIDA',decision=?,observation=?,resolved_at=?,updated_at=? WHERE id=? AND state!='RESOLVIDA' RETURNING *").bind(input.decision,input.observation||null,ts,ts,decisionId).first<Record<string,unknown>>();return result||null;
}

export async function setProjectProcessingState(env:Env,projectId:string,action:"CONTINUE"|"PAUSE"|"CANCEL"){
  const ts=nowMs(); const map={CONTINUE:{status:"RUNNING",pipeline:"EM_PROCESSAMENTO",next:"DISPATCH",sup:"LIVRE"},PAUSE:{status:"PAUSED",pipeline:"PAUSADO",next:"AGUARDAR_RETOMADA",sup:"PAUSADO"},CANCEL:{status:"CANCELLED",pipeline:"CANCELADO",next:null,sup:"CANCELADO"}}[action];
  return env.DB.prepare("UPDATE automatic_projects SET status=?,pipeline_status=?,next_action=?,supervisor_status=?,last_action=?,updated_at=?,state_version=state_version+1 WHERE id=? RETURNING *").bind(map.status,map.pipeline,map.next,map.sup,action,ts,projectId).first<Record<string,unknown>>();
}

export async function setItemProcessingState(env:Env,itemId:string,action:"PAUSE"|"RESUME"|"CANCEL"|"FREEZE"){
  const ts=nowMs(); const map={PAUSE:"PAUSED",RESUME:"PENDING",CANCEL:"CANCELLED",FREEZE:"FROZEN"}[action];
  const item=await env.DB.prepare("UPDATE automatic_project_items SET status=?,updated_at=? WHERE id=? RETURNING *").bind(map,ts,itemId).first<Record<string,unknown>>();
  if(item?.project_id)await reconcileAutomaticProject(env,String(item.project_id)); return item||null;
}

export async function relinkItem(env:Env,itemId:string,assetId:string){
  const asset=await env.DB.prepare("SELECT id FROM assets WHERE id=?").bind(assetId).first();if(!asset)return {error:"ASSET_NOT_FOUND"}; const ts=nowMs();
  const item=await env.DB.prepare("UPDATE automatic_project_items SET linked_asset_id=?,status='APPROVED',source_type='LIBRARY_RELINK',failure_reason=NULL,updated_at=? WHERE id=? RETURNING *").bind(assetId,ts,itemId).first<Record<string,unknown>>();if(!item)return {error:"ITEM_NOT_FOUND"};await reconcileAutomaticProject(env,String(item.project_id));return item;
}

export async function relinkItems(env:Env,pairs:Array<{itemId:string;assetId:string}>){const results:Array<{itemId:string;result:unknown}>=[];for(const pair of pairs)results.push({itemId:pair.itemId,result:await relinkItem(env,pair.itemId,pair.assetId)});return {count:results.length,results};}

export async function updateItemSearch(env:Env,itemId:string,input:{reference?:string;query?:string;source?:string}){
  const current=await env.DB.prepare("SELECT * FROM automatic_project_items WHERE id=?").bind(itemId).first<Record<string,unknown>>();if(!current)return null;const ts=nowMs();const strategy=parseJson(current.strategy_state,{} ) as Record<string,unknown>;
  if(input.reference!==undefined)strategy.reference=input.reference;if(input.query!==undefined)strategy.query=input.query;if(input.source!==undefined)strategy.source=input.source;
  return env.DB.prepare("UPDATE automatic_project_items SET semantic_reference=COALESCE(?,semantic_reference),search_plan=COALESCE(?,search_plan),source_type=COALESCE(?,source_type),strategy_state=?,updated_at=? WHERE id=? RETURNING *").bind(input.reference??null,input.query??null,input.source??null,JSON.stringify(strategy),ts,itemId).first<Record<string,unknown>>();
}

export async function setHostBlocked(env:Env,host:string,blocked:boolean,reason?:string){
  const normalized=host.trim().toLowerCase();if(!normalized)return {error:"INVALID_HOST"};const ts=nowMs();
  const current=await env.DB.prepare("SELECT * FROM materialization_host_health WHERE host=?").bind(normalized).first<Record<string,unknown>>();
  if(current){await env.DB.prepare("UPDATE materialization_host_health SET circuit_state=?,blocked_until=?,updated_at=? WHERE host=?").bind(blocked?"OPEN":"CLOSED",blocked?ts+3650*24*3600_000:null,ts,normalized).run();}
  else {await env.DB.prepare("INSERT INTO materialization_host_health (host,circuit_state,blocked_until,updated_at) VALUES (?,?,?,?)").bind(normalized,blocked?"OPEN":"CLOSED",blocked?ts+3650*24*3600_000:null,ts).run();}
  await env.DB.prepare("INSERT INTO supervisor_config_events (id,action,key,previous_value,next_value,source,reason,created_at) VALUES (?,?,?,?,?,'SUPERVISOR_MCP',?,?)").bind(id("SCFG"),blocked?"BLOCK_HOST":"UNBLOCK_HOST",normalized,current?.circuit_state||null,blocked?"OPEN":"CLOSED",reason||null,ts).run();
  return env.DB.prepare("SELECT * FROM materialization_host_health WHERE host=?").bind(normalized).first<Record<string,unknown>>();
}

export async function updateCollectionSource(env:Env,sourceId:string,input:{priority?:number;timeoutMs?:number;active?:boolean;note?:string}){
  const source=await env.DB.prepare("SELECT * FROM collection_sources WHERE id=?").bind(sourceId).first<Record<string,unknown>>();if(!source)return null;const ts=nowMs();
  return env.DB.prepare("UPDATE collection_sources SET priority=?,timeout_ms=?,active=?,note=?,updated_at=? WHERE id=? RETURNING *").bind(input.priority??source.priority,input.timeoutMs??source.timeout_ms,input.active===undefined?source.active:(input.active?1:0),input.note??source.note,ts,sourceId).first<Record<string,unknown>>();
}

export async function updateCollectionSettings(env:Env,input:{timeoutMs?:number;parallelism?:number;maxUrlsPerTerm?:number;maxSourcesPerTerm?:number;maxRounds?:number}){
  const ts=nowMs();const pairs:Array<[string,string]>=[];if(input.timeoutMs!==undefined)pairs.push(["collection_fetch_timeout_ms",String(input.timeoutMs)]);if(input.parallelism!==undefined)pairs.push(["collection_parallelism",String(input.parallelism)]);
  for(const [key,value] of pairs)await env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,value,ts).run();
  if(input.maxUrlsPerTerm!==undefined||input.maxSourcesPerTerm!==undefined||input.maxRounds!==undefined)await env.DB.prepare("UPDATE source_profiles SET max_urls_per_term=COALESCE(?,max_urls_per_term),max_sources_per_term=COALESCE(?,max_sources_per_term),max_rounds=COALESCE(?,max_rounds),updated_at=? WHERE status='ATIVO'").bind(input.maxUrlsPerTerm??null,input.maxSourcesPerTerm??null,input.maxRounds??null,ts).run();
  return {settings:await settings(env,"collection_")};
}

export async function listSourceProfiles(env:Env,limit=100){const rows=await env.DB.prepare("SELECT * FROM source_profiles ORDER BY is_default DESC,priority DESC,updated_at DESC LIMIT ?").bind(Math.max(1,Math.min(limit,500))).all<Record<string,unknown>>();return rows.results||[];}
export async function saveSourceProfile(env:Env,input:{name:string;type?:string;universes?:string[];compositionClass?:string;semanticClass?:string;preferredHosts?:string[];blockedHosts?:string[];preferredSources?:string[];queryTemplate?:string;negativeTerms?:string[];timeoutMs?:number;maxConsecutiveFailures?:number;maxUrlsPerTerm?:number;maxSourcesPerTerm?:number;maxRounds?:number;acceptedFormats?:string[];priority?:number;domain?:string;notes?:string}){
  const ts=nowMs(),profileId=id("SPROF");await env.DB.prepare(`INSERT INTO source_profiles (id,name,status,type,universes,composition_class,semantic_class,preferred_hosts,blocked_hosts,preferred_sources,query_template,negative_terms,timeout_ms,max_consecutive_failures,max_urls_per_term,max_sources_per_term,max_rounds,accepted_formats,priority,is_default,notes,created_at,updated_at,domain) VALUES (?,?,'ATIVO',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`).bind(profileId,input.name,input.type||"qualquer",JSON.stringify(input.universes||[]),input.compositionClass||null,input.semanticClass||null,JSON.stringify(input.preferredHosts||[]),JSON.stringify(input.blockedHosts||[]),JSON.stringify(input.preferredSources||[]),input.queryTemplate||null,JSON.stringify(input.negativeTerms||[]),input.timeoutMs||5000,input.maxConsecutiveFailures||2,input.maxUrlsPerTerm||60,input.maxSourcesPerTerm||20,input.maxRounds||3,JSON.stringify(input.acceptedFormats||["png","webp","jpg","jpeg"]),input.priority||3,input.notes||null,ts,ts,input.domain||"GENERAL").run();return env.DB.prepare("SELECT * FROM source_profiles WHERE id=?").bind(profileId).first<Record<string,unknown>>();
}
export async function updateSourceProfile(env:Env,profileId:string,input:Record<string,unknown>){const current=await env.DB.prepare("SELECT * FROM source_profiles WHERE id=?").bind(profileId).first<Record<string,unknown>>();if(!current)return null;const allowed:Record<string,string>={name:"name",type:"type",compositionClass:"composition_class",semanticClass:"semantic_class",queryTemplate:"query_template",timeoutMs:"timeout_ms",maxConsecutiveFailures:"max_consecutive_failures",maxUrlsPerTerm:"max_urls_per_term",maxSourcesPerTerm:"max_sources_per_term",maxRounds:"max_rounds",priority:"priority",domain:"domain",notes:"notes"};const jsonFields:Record<string,string>={universes:"universes",preferredHosts:"preferred_hosts",blockedHosts:"blocked_hosts",preferredSources:"preferred_sources",negativeTerms:"negative_terms",acceptedFormats:"accepted_formats"};const sets:string[]=[];const values:unknown[]=[];for(const [k,col] of Object.entries(allowed))if(input[k]!==undefined){sets.push(`${col}=?`);values.push(input[k])}for(const [k,col] of Object.entries(jsonFields))if(input[k]!==undefined){sets.push(`${col}=?`);values.push(JSON.stringify(input[k]))}if(!sets.length)return current;sets.push("updated_at=?");values.push(nowMs(),profileId);return env.DB.prepare(`UPDATE source_profiles SET ${sets.join(",")} WHERE id=? RETURNING *`).bind(...values).first<Record<string,unknown>>();}
export async function setSourceProfileStatus(env:Env,profileId:string,status:string){return env.DB.prepare("UPDATE source_profiles SET status=?,updated_at=? WHERE id=? RETURNING *").bind(status,nowMs(),profileId).first<Record<string,unknown>>();}
export async function setDefaultSourceProfile(env:Env,profileId:string){const profile=await env.DB.prepare("SELECT id FROM source_profiles WHERE id=?").bind(profileId).first();if(!profile)return null;const ts=nowMs();await env.DB.batch([env.DB.prepare("UPDATE source_profiles SET is_default=0,updated_at=? WHERE is_default=1").bind(ts),env.DB.prepare("UPDATE source_profiles SET is_default=1,status='ATIVO',updated_at=? WHERE id=?").bind(ts,profileId),env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('supervisor_default_source_profile',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(profileId,ts)]);return env.DB.prepare("SELECT * FROM source_profiles WHERE id=?").bind(profileId).first<Record<string,unknown>>();}

export async function listSupervisorCandidates(env:Env,input:{projectId?:string;status?:string;limit?:number}){const where:string[]=["(c.item_id IS NULL OR EXISTS (SELECT 1 FROM automatic_project_items i WHERE i.id=c.item_id))","(c.project_id IS NULL OR EXISTS (SELECT 1 FROM automatic_projects p WHERE p.id=c.project_id))"];const values:unknown[]=[];if(input.projectId){where.push("c.project_id=?");values.push(input.projectId)}if(input.status){where.push("c.status=?");values.push(input.status)}values.push(Math.max(1,Math.min(input.limit||100,500)));const rows=await env.DB.prepare(`SELECT c.*,f.r2_key,f.mime_type,f.size_bytes,f.sha256 FROM supervisor_project_candidates c LEFT JOIN materialization_files f ON f.id=c.materialization_file_id WHERE ${where.join(" AND ")} ORDER BY c.created_at ASC LIMIT ?`).bind(...values).all<Record<string,unknown>>();return rows.results||[];}
export async function listSupervisorCandidatesWithLinks(request:Request,env:Env,input:{projectId?:string;status?:string;limit?:number}){const items=await listSupervisorCandidates(env,input);return Promise.all(items.map(async item=>({...item,previewUrl:item.r2_key?await createSignedSupervisorCandidateUrl(request,String(item.id),env,900):null})));}
export async function decideSupervisorCandidate(env:Env,candidateId:string,decision:"APPROVED"|"REJECTED",reason?:string){const current=await env.DB.prepare("SELECT c.*,CASE WHEN c.item_id IS NULL OR EXISTS (SELECT 1 FROM automatic_project_items i WHERE i.id=c.item_id) THEN 1 ELSE 0 END AS item_valid,CASE WHEN c.project_id IS NULL OR EXISTS (SELECT 1 FROM automatic_projects p WHERE p.id=c.project_id) THEN 1 ELSE 0 END AS project_valid FROM supervisor_project_candidates c WHERE c.id=?").bind(candidateId).first<Record<string,unknown>>();if(!current)return null;if(Number(current.item_valid)!==1||Number(current.project_valid)!==1)return {error:"HISTORICAL_ORPHAN_IGNORED",candidateId,itemId:current.item_id||null,projectId:current.project_id||null};const ts=nowMs();const row=await env.DB.prepare("UPDATE supervisor_project_candidates SET status=?,metadata=json_set(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,'$.decisionReason',?),updated_at=? WHERE id=? RETURNING *").bind(decision,reason||null,ts,candidateId).first<Record<string,unknown>>();return row||null;}

export async function nightlySummary(env:Env){const [status,decisions,profiles,failed]=await Promise.all([supervisorStatus(env),listSupervisorDecisions(env,{state:"PENDENTE",limit:50}),listSourceProfiles(env,20),env.DB.prepare("SELECT COUNT(*) AS count FROM worker_work_items WHERE status='FAILED'").first<{count:number}>()]);return {generatedAt:nowMs(),supervisor:status,pendingDecisions:decisions.length,workerFailures:Number(failed?.count||0),profiles:profiles.map(p=>({id:p.id,name:p.name,status:p.status,priority:p.priority}))};}
