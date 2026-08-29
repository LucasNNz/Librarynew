import type { Env } from "../types";
import { id, nowMs } from "./ids";
import { bindingStatus } from "./settings";

export type InfrastructureProfileInput = {
  bffProjectName?: string;
  workerName?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  queueName?: string;
  dlqName?: string;
};

type InfrastructureRow = {
  id:string;
  instance_id:string;
  revision:number;
  lock_state:string;
  bff_project_name:string;
  worker_name:string;
  d1_database_name:string;
  r2_bucket_name:string;
  queue_name:string;
  dlq_name:string;
  configured_at:number;
  updated_at:number;
  last_verified_at:number|null;
  metadata_json:string;
};

const PROFILE_ID = "primary";
const DEFAULTS = {
  bffProjectName: "corvo-library-v2",
  workerName: "corvo-core-v2",
  d1DatabaseName: "corvo-library-v2",
  r2BucketName: "corvoquiz-prod",
  queueName: "corvo-materialize-v2",
  dlqName: "corvo-materialize-v2-dlq",
};

function cleanName(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (text.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(text)) throw new Error("INVALID_INFRASTRUCTURE_NAME");
  return text;
}

function normalize(input: InfrastructureProfileInput = {}) {
  return {
    bffProjectName: cleanName(input.bffProjectName, DEFAULTS.bffProjectName),
    workerName: cleanName(input.workerName, DEFAULTS.workerName),
    d1DatabaseName: cleanName(input.d1DatabaseName, DEFAULTS.d1DatabaseName),
    r2BucketName: cleanName(input.r2BucketName, DEFAULTS.r2BucketName),
    queueName: cleanName(input.queueName, DEFAULTS.queueName),
    dlqName: cleanName(input.dlqName, DEFAULTS.dlqName),
  };
}

function publicProfile(row: InfrastructureRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    instanceId: row.instance_id,
    revision: row.revision,
    lockState: row.lock_state,
    bffProjectName: row.bff_project_name,
    workerName: row.worker_name,
    d1DatabaseName: row.d1_database_name,
    r2BucketName: row.r2_bucket_name,
    queueName: row.queue_name,
    dlqName: row.dlq_name,
    configuredAt: row.configured_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

async function row(env:Env) {
  return env.DB.prepare("SELECT * FROM v2_infrastructure_profiles WHERE id=?").bind(PROFILE_ID).first<InfrastructureRow>();
}

export async function getInfrastructureProfile(env:Env) {
  const current = await row(env);
  const events = current ? await env.DB.prepare("SELECT id,event_type,previous_revision,next_revision,source,created_at FROM v2_infrastructure_config_events WHERE profile_id=? ORDER BY created_at DESC LIMIT 20").bind(PROFILE_ID).all<Record<string,unknown>>() : {results:[]};
  return { initialized:Boolean(current), profile:publicProfile(current), bindings:await bindingStatus(env), events:events.results || [] };
}

export async function initializeInfrastructureProfile(env:Env, input:InfrastructureProfileInput = {}) {
  const existing = await row(env);
  if (existing) return { error:"INFRASTRUCTURE_ALREADY_INITIALIZED", status:409, profile:publicProfile(existing) };
  const values = normalize(input);
  const ts = nowMs();
  const instanceId = id("INST");
  const next = { id:PROFILE_ID, instanceId, revision:1, lockState:"LOCKED", ...values, configuredAt:ts, updatedAt:ts, lastVerifiedAt:null };
  const snapshot = JSON.stringify(next);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_infrastructure_profiles (id,instance_id,revision,lock_state,bff_project_name,worker_name,d1_database_name,r2_bucket_name,queue_name,dlq_name,configured_at,updated_at,last_verified_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(PROFILE_ID,instanceId,1,"LOCKED",values.bffProjectName,values.workerName,values.d1DatabaseName,values.r2BucketName,values.queueName,values.dlqName,ts,ts,null,"{}"),
    env.DB.prepare("INSERT INTO v2_infrastructure_config_events (id,profile_id,event_type,previous_revision,next_revision,previous_json,next_json,source,created_at) VALUES (?,?, 'INITIALIZED',NULL,1,NULL,?,'SETUP_WIZARD',?)")
      .bind(id("ICFG"),PROFILE_ID,snapshot,ts),
  ]);
  return { initialized:true, profile:next, bindings:await bindingStatus(env) };
}

export async function alterInfrastructureProfile(env:Env, input:InfrastructureProfileInput & { expectedRevision?:number; confirmChange?:boolean }) {
  if (input.confirmChange !== true) return { error:"EXPLICIT_CHANGE_CONFIRMATION_REQUIRED", status:400 };
  const current = await row(env);
  if (!current) return { error:"INFRASTRUCTURE_NOT_INITIALIZED", status:404 };
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== current.revision) return { error:"INFRASTRUCTURE_REVISION_CONFLICT", status:409, currentRevision:current.revision };
  const values = normalize({
    bffProjectName: input.bffProjectName ?? current.bff_project_name,
    workerName: input.workerName ?? current.worker_name,
    d1DatabaseName: input.d1DatabaseName ?? current.d1_database_name,
    r2BucketName: input.r2BucketName ?? current.r2_bucket_name,
    queueName: input.queueName ?? current.queue_name,
    dlqName: input.dlqName ?? current.dlq_name,
  });
  const ts = nowMs();
  const nextRevision = current.revision + 1;
  const previous = JSON.stringify(publicProfile(current));
  const next = { id:PROFILE_ID, instanceId:current.instance_id, revision:nextRevision, lockState:"LOCKED", ...values, configuredAt:current.configured_at, updatedAt:ts, lastVerifiedAt:current.last_verified_at };
  const nextJson = JSON.stringify(next);
  const result = await env.DB.prepare("UPDATE v2_infrastructure_profiles SET revision=?,bff_project_name=?,worker_name=?,d1_database_name=?,r2_bucket_name=?,queue_name=?,dlq_name=?,updated_at=? WHERE id=? AND revision=?")
    .bind(nextRevision,values.bffProjectName,values.workerName,values.d1DatabaseName,values.r2BucketName,values.queueName,values.dlqName,ts,PROFILE_ID,current.revision).run();
  if (!result.meta.changes) return { error:"INFRASTRUCTURE_REVISION_CONFLICT", status:409 };
  await env.DB.prepare("INSERT INTO v2_infrastructure_config_events (id,profile_id,event_type,previous_revision,next_revision,previous_json,next_json,source,created_at) VALUES (?,?,'ALTERED',?,?,?,?, 'EXPLICIT_UI_CHANGE',?)")
    .bind(id("ICFG"),PROFILE_ID,current.revision,nextRevision,previous,nextJson,ts).run();
  return { changed:true, profile:next, bindings:await bindingStatus(env) };
}

export async function verifyInfrastructureProfile(env:Env) {
  const current = await row(env);
  if (!current) return { error:"INFRASTRUCTURE_NOT_INITIALIZED", status:404 };
  const bindings = await bindingStatus(env);
  const healthy = bindings.d1 && bindings.r2 && bindings.queue && bindings.internalKey && bindings.signingKey;
  const ts = nowMs();
  await env.DB.prepare("UPDATE v2_infrastructure_profiles SET last_verified_at=? WHERE id=?").bind(ts,PROFILE_ID).run();
  await env.DB.prepare("INSERT INTO v2_infrastructure_config_events (id,profile_id,event_type,previous_revision,next_revision,previous_json,next_json,source,created_at) VALUES (?,?,'VERIFIED',?,?,NULL,?,'HEALTH_CHECK',?)")
    .bind(id("ICFG"),PROFILE_ID,current.revision,current.revision,JSON.stringify({healthy,bindings}),ts).run();
  return { healthy, profile:{...publicProfile(current),lastVerifiedAt:ts}, bindings };
}
