import type { Env } from "../types";

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
