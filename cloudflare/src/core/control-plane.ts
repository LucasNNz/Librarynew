import type { Env } from "../types";
import { reconcileCriticalSchema } from "./schema-contract";

const CF_API = "https://api.cloudflare.com/client/v4";

function required(value: string | undefined, name: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_MISSING`);
  return text;
}

async function cloudflarePut(env: Env, bundle: string) {
  const token = required(env.CLOUDFLARE_CONTROL_TOKEN, "CLOUDFLARE_CONTROL_TOKEN");
  const accountId = required(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const workerName = required(env.CORVO_WORKER_NAME, "CORVO_WORKER_NAME");
  const databaseId = required(env.CORVO_D1_DATABASE_ID, "CORVO_D1_DATABASE_ID");
  const r2BucketName = required(env.CORVO_R2_BUCKET_NAME, "CORVO_R2_BUCKET_NAME");
  const queueName = required(env.CORVO_QUEUE_NAME, "CORVO_QUEUE_NAME");
  const dlqName = required(env.CORVO_DLQ_NAME, "CORVO_DLQ_NAME");
  const appOrigin = required(env.CORVO_APP_ORIGIN, "CORVO_APP_ORIGIN");

  const metadata = {
    main_module: "corvo-core-v2.mjs",
    compatibility_date: "2026-08-29",
    bindings: [
      { type: "d1", name: "DB", id: databaseId },
      { type: "r2_bucket", name: "MEDIA", bucket_name: r2BucketName },
      { type: "queue", name: "MATERIALIZE_QUEUE", queue_name: queueName },
      { type: "secret_text", name: "CORVO_INTERNAL_KEY", text: env.CORVO_INTERNAL_KEY },
      { type: "secret_text", name: "CORVO_APP_KEY", text: env.CORVO_APP_KEY },
      { type: "secret_text", name: "CORVO_SIGNING_KEY", text: env.CORVO_SIGNING_KEY },
      { type: "secret_text", name: "CLOUDFLARE_CONTROL_TOKEN", text: token },
      { type: "plain_text", name: "CLOUDFLARE_ACCOUNT_ID", text: accountId },
      { type: "plain_text", name: "CORVO_WORKER_NAME", text: workerName },
      { type: "plain_text", name: "CORVO_D1_DATABASE_ID", text: databaseId },
      { type: "plain_text", name: "CORVO_R2_BUCKET_NAME", text: r2BucketName },
      { type: "plain_text", name: "CORVO_QUEUE_NAME", text: queueName },
      { type: "plain_text", name: "CORVO_DLQ_NAME", text: dlqName },
      { type: "plain_text", name: "CORVO_APP_ORIGIN", text: appOrigin },
    ],
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  form.append("corvo-core-v2.mjs", new Blob([bundle], { type: "application/javascript+module" }), "corvo-core-v2.mjs");
  const response = await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CORE_SELF_UPDATE_HTTP_${response.status}:${text.slice(0, 300)}`);
  type DeployEnvelope = { success?: boolean; errors?: Array<{ message?: string }> };
  let payload: DeployEnvelope | null = null;
  try { payload = text ? JSON.parse(text) as DeployEnvelope : null; } catch { payload = null; }
  if (payload?.success === false) throw new Error(payload.errors?.map((item: { message?: string }) => item.message).filter(Boolean).join(" · ") || "CORE_SELF_UPDATE_REJECTED");
}


function randomSecret(bytes = 32) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let binary = "";
  for (const value of raw) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function putWorkerSecret(env: Env, name: string, text: string) {
  const token = required(env.CLOUDFLARE_CONTROL_TOKEN, "CLOUDFLARE_CONTROL_TOKEN");
  const accountId = required(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const workerName = required(env.CORVO_WORKER_NAME, "CORVO_WORKER_NAME");
  const response = await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, text, type: "secret_text" }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`WORKER_SECRET_ROTATE_HTTP_${response.status}:${body.slice(0,300)}`);
  type SecretEnvelope = { success?: boolean; errors?: Array<{message?:string}> };
  let payload: SecretEnvelope | null = null;
  try { payload = body ? JSON.parse(body) as SecretEnvelope : null; } catch { payload = null; }
  if (payload?.success === false) throw new Error(payload.errors?.map((item:{message?:string})=>item.message).filter(Boolean).join(" · ") || "WORKER_SECRET_ROTATE_REJECTED");
}

export async function rotateAppKey(env: Env) {
  const appKey = randomSecret(32);
  await putWorkerSecret(env, "CORVO_APP_KEY", appKey);
  return { ok:true, appKey, rotatedAt:Date.now() };
}

export async function selfUpdateCore(env: Env) {
  const appOrigin = required(env.CORVO_APP_ORIGIN, "CORVO_APP_ORIGIN").replace(/\/$/, "");
  const source = await fetch(`${appOrigin}/api/setup/core-bundle`, { headers: { accept: "application/javascript" } });
  if (!source.ok) throw new Error(`CORE_BUNDLE_HTTP_${source.status}`);
  const version = source.headers.get("x-corvo-core-version") || "unknown";
  const bundle = await source.text();
  if (bundle.length < 10_000 || bundle.length > 8_000_000) throw new Error("CORE_BUNDLE_SIZE_INVALID");
  await cloudflarePut(env, bundle);
  return { ok: true, targetVersion: version, source: `${appOrigin}/api/setup/core-bundle` };
}


const QUEUE_POLICY_VERSION = "LOW_LATENCY_V2";
const DESIRED_QUEUE_CONSUMER_SETTINGS = {
  batch_size: 10,
  max_concurrency: null as number | null,
  max_retries: 4,
  max_wait_time_ms: 0,
  retry_delay: 5,
};

type CfEnvelope<T> = { success?:boolean; result?:T; errors?:Array<{message?:string}> };
type QueueControlInfo = { queue_id?:string; queue_name?:string; settings?:Record<string,unknown> };
type QueueConsumerControlInfo = { consumer_id?:string; script_name?:string; type?:string; dead_letter_queue?:string; settings?:Record<string,unknown> };

async function cfControlResult<T>(env:Env,path:string,init:RequestInit={}) {
  const token=required(env.CLOUDFLARE_CONTROL_TOKEN,"CLOUDFLARE_CONTROL_TOKEN");
  const response=await fetch(`${CF_API}${path}`,{
    ...init,
    headers:{authorization:`Bearer ${token}`,...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})},
  });
  const text=await response.text();
  let payload:CfEnvelope<T>|null=null;
  try{payload=text?JSON.parse(text) as CfEnvelope<T>:null;}catch{payload=null;}
  if(!response.ok||payload?.success===false){
    const detail=payload?.errors?.map(item=>item.message).filter(Boolean).join(" · ")||text.slice(0,300)||`HTTP_${response.status}`;
    throw new Error(`QUEUE_CONTROL_HTTP_${response.status}:${detail}`);
  }
  return payload?.result as T;
}

export async function reconcileQueueConsumerPolicy(env:Env,input:{force?:boolean}={}) {
  const accountId=required(env.CLOUDFLARE_ACCOUNT_ID,"CLOUDFLARE_ACCOUNT_ID");
  const queueName=required(env.CORVO_QUEUE_NAME,"CORVO_QUEUE_NAME");
  const workerName=required(env.CORVO_WORKER_NAME,"CORVO_WORKER_NAME");
  const dlqName=required(env.CORVO_DLQ_NAME,"CORVO_DLQ_NAME");

  if(!input.force){
    const marker=await env.DB.prepare("SELECT value FROM v2_schema_meta WHERE key='queue_consumer_policy'").first<{value:string}>().catch(()=>null);
    if(marker?.value===QUEUE_POLICY_VERSION){
      return {ok:true,policyVersion:QUEUE_POLICY_VERSION,cached:true,desiredSettings:DESIRED_QUEUE_CONSUMER_SETTINGS};
    }
  }

  const queues=await cfControlResult<QueueControlInfo[]>(env,`/accounts/${encodeURIComponent(accountId)}/queues?per_page=100`);
  const queue=(queues||[]).find(item=>String(item.queue_name||"")===queueName);
  if(!queue?.queue_id) throw new Error(`QUEUE_NOT_FOUND:${queueName}`);
  const queueId=String(queue.queue_id);

  const beforeQueueSettings={...(queue.settings||{})};
  if(Number(beforeQueueSettings.delivery_delay||0)!==0||beforeQueueSettings.delivery_paused===true){
    await cfControlResult<QueueControlInfo>(env,`/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}`,{
      method:"PATCH",
      body:JSON.stringify({queue_name:queueName,settings:{delivery_delay:0,delivery_paused:false}}),
    });
  }

  const consumers=await cfControlResult<QueueConsumerControlInfo[]>(env,`/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers`);
  const existing=(consumers||[]).find(item=>item.script_name===workerName&&item.consumer_id)
    ||(consumers||[]).find(item=>item.consumer_id&&item.type!=="http_pull");
  if((consumers||[]).some(item=>item.type==="http_pull")&&!existing) throw new Error("QUEUE_HAS_HTTP_PULL_CONSUMER");

  const desired={type:"worker",script_name:workerName,dead_letter_queue:dlqName,settings:DESIRED_QUEUE_CONSUMER_SETTINGS};
  const beforeConsumerSettings={...(existing?.settings||{})};
  const consumer=existing?.consumer_id
    ? await cfControlResult<QueueConsumerControlInfo>(env,`/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers/${encodeURIComponent(String(existing.consumer_id))}`,{method:"PUT",body:JSON.stringify(desired)})
    : await cfControlResult<QueueConsumerControlInfo>(env,`/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers`,{method:"POST",body:JSON.stringify(desired)});

  const now=Date.now();
  await env.DB.prepare("INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('queue_consumer_policy',?,?)").bind(QUEUE_POLICY_VERSION,now).run();
  return {
    ok:true,
    policyVersion:QUEUE_POLICY_VERSION,
    cached:false,
    queue:{name:queueName,id:queueId,before:beforeQueueSettings,deliveryDelay:0,deliveryPaused:false},
    consumer:{id:consumer?.consumer_id||existing?.consumer_id||null,scriptName:workerName,before:beforeConsumerSettings,settings:consumer?.settings||DESIRED_QUEUE_CONSUMER_SETTINGS},
  };
}

type MigrationPayload = { version?:string; schemaVersion?:string; items?:Array<{name:string;sql:string;checksum?:string}> };

const LEGACY_DESTRUCTIVE_MIGRATIONS = new Set([
  "9008_v2_operational_cleanup_recovery.sql",
  "9010_v2_clean_zero_baseline.sql",
  "9011_v2_purge_all_projects.sql",
  "9012_v2_factory_zero_assets.sql",
  "9013_v2_live_factory_zero_gate.sql",
]);

// D1Database.exec() treats newlines as query separators. Migration files contain
// multiline CREATE/INSERT statements, so feeding the raw file to exec() can turn
// a valid SQL file into an "incomplete input" error. Split only on semicolons
// outside quoted strings/comments and execute each complete statement separately.
export function splitMigrationStatements(sql:string) {
  const statements:string[]=[];
  let buffer="";
  let quote:"'"|'\"'|'`'|'['|null=null;
  let lineComment=false;
  let blockComment=false;

  for(let i=0;i<sql.length;i+=1){
    const ch=sql[i];
    const next=sql[i+1] || "";

    if(lineComment){
      if(ch==="\n"){ lineComment=false; buffer+="\n"; }
      continue;
    }
    if(blockComment){
      if(ch==="*" && next==="/"){ blockComment=false; i+=1; }
      continue;
    }
    if(!quote && ch==="-" && next==="-"){ lineComment=true; i+=1; continue; }
    if(!quote && ch==="/" && next==="*"){ blockComment=true; i+=1; continue; }

    if(quote){
      buffer+=ch;
      if(quote==="["){
        if(ch==="]") quote=null;
        continue;
      }
      if(ch===quote){
        if(next===quote){ buffer+=next; i+=1; }
        else quote=null;
      }
      continue;
    }

    if(ch==="'" || ch==='"' || ch==="`" || ch==="["){
      quote=ch as "'"|'\"'|'`'|'[';
      buffer+=ch;
      continue;
    }
    if(ch===";"){
      const statement=buffer.trim();
      if(statement) statements.push(statement);
      buffer="";
      continue;
    }
    buffer+=ch;
  }

  const tail=buffer.trim();
  if(tail) statements.push(tail);
  if(quote || blockComment) throw new Error("MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT");
  return statements;
}

async function executeMigrationSql(env:Env, sql:string) {
  // D1 enforces foreign keys for queries/migrations; PRAGMA foreign_keys from
  // legacy SQLite files is neither required nor useful in live Worker execution.
  const statements=splitMigrationStatements(sql).filter(statement=>!/^PRAGMA\s+foreign_keys\s*=/i.test(statement));
  if(!statements.length) return 0;
  // A D1 batch is transactional: if one complete statement fails, the whole
  // migration batch is rolled back instead of leaving a half-applied file.
  await env.DB.batch(statements.map(statement=>env.DB.prepare(statement)));
  return statements.length;
}

async function ensureMigrationAudit(env:Env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS v2_migration_decisions (
    name TEXT PRIMARY KEY NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    decided_at INTEGER NOT NULL
  )`).run();
}

async function registerMigration(env:Env,item:{name:string;checksum?:string},decision:"APPLIED"|"SKIPPED_LEGACY_DESTRUCTIVE",reason:string) {
  const now=Date.now();
  await env.DB.prepare("INSERT OR REPLACE INTO v2_migrations_applied (name,checksum,applied_at) VALUES (?,?,?)")
    .bind(item.name,item.checksum||"",now).run();
  await env.DB.prepare("INSERT OR REPLACE INTO v2_migration_decisions (name,decision,reason,checksum,decided_at) VALUES (?,?,?,?,?)")
    .bind(item.name,decision,reason,item.checksum||"",now).run();
}

export async function applyMigrationsFromApp(env: Env) {
  const appOrigin = required(env.CORVO_APP_ORIGIN, "CORVO_APP_ORIGIN").replace(/\/$/, "");
  const response = await fetch(`${appOrigin}/api/setup/migrations`, { headers:{accept:"application/json"} });
  if (!response.ok) throw new Error(`MIGRATION_MANIFEST_HTTP_${response.status}`);
  const payload = await response.json() as MigrationPayload;
  const items = Array.isArray(payload.items) ? payload.items.filter(item=>/^\d+_.*\.sql$/.test(item.name) && typeof item.sql==="string") : [];
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS v2_migrations_applied (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL DEFAULT '', applied_at INTEGER NOT NULL)").run();
  await ensureMigrationAudit(env);
  const rows = await env.DB.prepare("SELECT name FROM v2_migrations_applied").all<{name:string}>();
  const applied = new Set((rows.results||[]).map(row=>String(row.name)));
  const executed:string[]=[];
  const skippedLegacy:string[]=[];
  let executedStatements=0;

  // Repair drift BEFORE replaying pending migrations. If 9016 is absent from
  // the registry but its contract is now satisfied by reconciliation, register
  // it as satisfied instead of replaying brittle ALTER TABLE statements.
  const preSchemaContract = await reconcileCriticalSchema(env).catch(()=>null);
  const collectorMigration = items.find(item=>item.name==="9016_v2_collector_qa_pipeline.sql");
  if (preSchemaContract?.ready && collectorMigration && !applied.has(collectorMigration.name)) {
    await registerMigration(env,collectorMigration,"APPLIED","schema_contract_reconciled");
    applied.add(collectorMigration.name);
  }

  for(const item of items){
    if(applied.has(item.name)) continue;

    // These files were one-time historical reset instructions, not forward
    // schema migrations. Replaying them on an operational Library can delete
    // assets/projects or schedule R2 purges. Preserve history by recording the
    // decision, but never execute them during normal boot/update.
    if(LEGACY_DESTRUCTIVE_MIGRATIONS.has(item.name)){
      await registerMigration(env,item,"SKIPPED_LEGACY_DESTRUCTIVE","historical_reset_not_safe_for_live_boot");
      applied.add(item.name);
      skippedLegacy.push(item.name);
      continue;
    }

    executedStatements += await executeMigrationSql(env,item.sql);
    await registerMigration(env,item,"APPLIED","normal_forward_migration");
    applied.add(item.name);
    executed.push(item.name);
  }

  // Always reconcile the critical collector/QA contract, even if the migration
  // registry says 9016 was already applied. This repairs schema drift safely.
  const schemaContract = await reconcileCriticalSchema(env);
  if (!schemaContract.ready) throw new Error(`SCHEMA_CONTRACT_NOT_READY:${JSON.stringify(schemaContract)}`);
  return {ok:true,targetVersion:payload.version||null,schemaVersion:payload.schemaVersion||null,executed,skippedLegacy,executedStatements,schemaContract};
}
