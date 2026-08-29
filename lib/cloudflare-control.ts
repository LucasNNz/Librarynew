import { randomBytes } from "node:crypto";

const API = "https://api.cloudflare.com/client/v4";

export type CloudflareAccount = { id: string; name: string };
export type D1Database = { uuid?: string; id?: string; name: string; version?: string };
export type QueueInfo = { queue_id: string; queue_name: string };

type Envelope<T> = { success: boolean; result: T; errors?: Array<{ code?: number; message?: string }>; messages?: Array<{ code?: number; message?: string }> };

export class CloudflareApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.details = details;
  }
}

function messageFrom(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const envelope = value as Partial<Envelope<unknown>>;
  const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
  const message = errors.map(item => item?.message).filter(Boolean).join(" · ");
  return message || fallback;
}

export async function cfApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  const text = await response.text();
  let body: Envelope<T> | null = null;
  try { body = text ? JSON.parse(text) as Envelope<T> : null; } catch { body = null; }
  if (!response.ok || !body?.success) throw new CloudflareApiError(messageFrom(body, `Cloudflare HTTP ${response.status}`), response.status, body || text);
  return body.result;
}

export async function listAccounts(token: string): Promise<CloudflareAccount[]> {
  const result = await cfApi<CloudflareAccount[]>(token, "/accounts?per_page=50");
  return Array.isArray(result) ? result.map(item => ({ id: String(item.id), name: String(item.name || item.id) })) : [];
}

export async function getOrCreateD1(token: string, accountId: string, name: string): Promise<{ id: string; name: string; created: boolean }> {
  const databases = await cfApi<D1Database[]>(token, `/accounts/${encodeURIComponent(accountId)}/d1/database?per_page=100`);
  const existing = (Array.isArray(databases) ? databases : []).find(item => item.name === name);
  if (existing) return { id: String(existing.uuid || existing.id), name, created: false };
  const created = await cfApi<D1Database>(token, `/accounts/${encodeURIComponent(accountId)}/d1/database`, { method: "POST", body: JSON.stringify({ name }) });
  const id = String(created.uuid || created.id || "");
  if (!id) throw new CloudflareApiError("D1_CREATE_NO_ID", 500, created);
  return { id, name, created: true };
}

export async function assertR2Bucket(token: string, accountId: string, bucketName: string) {
  try {
    await cfApi<Record<string, unknown>>(token, `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}`);
    return { name: bucketName, exists: true };
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) throw new CloudflareApiError(`Bucket R2 \"${bucketName}\" não encontrado.`, 404, error.details);
    throw error;
  }
}

export async function getOrCreateQueue(token: string, accountId: string, queueName: string): Promise<{ id: string; name: string; created: boolean }> {
  const queues = await cfApi<QueueInfo[]>(token, `/accounts/${encodeURIComponent(accountId)}/queues?per_page=100`);
  const existing = (Array.isArray(queues) ? queues : []).find(item => item.queue_name === queueName);
  if (existing) return { id: String(existing.queue_id), name: queueName, created: false };
  const created = await cfApi<QueueInfo>(token, `/accounts/${encodeURIComponent(accountId)}/queues`, { method: "POST", body: JSON.stringify({ queue_name: queueName }) });
  if (!created?.queue_id) throw new CloudflareApiError("QUEUE_CREATE_NO_ID", 500, created);
  return { id: String(created.queue_id), name: queueName, created: true };
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export type WorkerDeployInput = {
  token: string;
  accountId: string;
  workerName: string;
  databaseId: string;
  r2BucketName: string;
  queueName: string;
  dlqName: string;
  appKey: string;
  internalKey: string;
  signingKey: string;
  workerBundle: string;
  appOrigin: string;
};

export async function deployWorker(input: WorkerDeployInput) {
  const metadata = {
    main_module: "corvo-core-v2.mjs",
    compatibility_date: "2026-08-29",
    bindings: [
      { type: "d1", name: "DB", id: input.databaseId },
      { type: "r2_bucket", name: "MEDIA", bucket_name: input.r2BucketName },
      { type: "queue", name: "MATERIALIZE_QUEUE", queue_name: input.queueName },
      { type: "secret_text", name: "CORVO_INTERNAL_KEY", text: input.internalKey },
      { type: "secret_text", name: "CORVO_APP_KEY", text: input.appKey },
      { type: "secret_text", name: "CORVO_SIGNING_KEY", text: input.signingKey },
      { type: "secret_text", name: "CLOUDFLARE_CONTROL_TOKEN", text: input.token },
      { type: "plain_text", name: "CLOUDFLARE_ACCOUNT_ID", text: input.accountId },
      { type: "plain_text", name: "CORVO_WORKER_NAME", text: input.workerName },
      { type: "plain_text", name: "CORVO_D1_DATABASE_ID", text: input.databaseId },
      { type: "plain_text", name: "CORVO_R2_BUCKET_NAME", text: input.r2BucketName },
      { type: "plain_text", name: "CORVO_QUEUE_NAME", text: input.queueName },
      { type: "plain_text", name: "CORVO_DLQ_NAME", text: input.dlqName },
      { type: "plain_text", name: "CORVO_APP_ORIGIN", text: input.appOrigin },
    ],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  form.append("corvo-core-v2.mjs", new Blob([input.workerBundle], { type: "application/javascript+module" }), "corvo-core-v2.mjs");
  await cfApi<unknown>(input.token, `/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.workerName)}`, { method: "PUT", body: form });

  // Enable the stable workers.dev route for the script. If already enabled, Cloudflare treats this as an update.
  await cfApi<unknown>(input.token, `/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.workerName)}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });

  const accountSubdomain = await cfApi<{ subdomain: string }>(input.token, `/accounts/${encodeURIComponent(input.accountId)}/workers/subdomain`);
  const coreUrl = `https://${input.workerName}.${accountSubdomain.subdomain}.workers.dev`;
  return { coreUrl };
}

export async function ensureQueueConsumer(token: string, accountId: string, queueId: string, workerName: string, dlqName: string) {
  const consumers = await cfApi<Array<{ consumer_id?: string; script_name?: string; type?: string }>>(token, `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers`);
  const existing = (Array.isArray(consumers) ? consumers : []).find(item => item.type === "worker" && item.script_name === workerName);
  if (existing) return { created: false, id: existing.consumer_id || null };
  const result = await cfApi<{ consumer_id?: string }>(token, `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers`, {
    method: "POST",
    body: JSON.stringify({
      type: "worker",
      script_name: workerName,
      dead_letter_queue: dlqName,
      settings: { batch_size: 10, max_retries: 4, retry_delay: 10 },
    }),
  });
  return { created: true, id: result.consumer_id || null };
}

export async function queryD1<T = Record<string, unknown>>(token: string, accountId: string, databaseId: string, sql: string, params: unknown[] = []) {
  return cfApi<Array<{ results?: T[]; success?: boolean }>>(token, `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  });
}
