import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cf = resolve(root, "cloudflare");
const args = new Map(process.argv.slice(2).map((part) => {
  const [key, ...rest] = part.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const names = {
  d1: String(args.get("d1") || "corvo-library-v2"),
  r2: String(args.get("r2") || "corvoquiz-prod"),
  queue: String(args.get("queue") || "corvo-materialize-v2"),
  dlq: String(args.get("dlq") || "corvo-materialize-v2-dlq"),
};

function run(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { cwd: options.cwd || root, env: process.env, shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { const text = String(chunk); stdout += text; if (!options.quiet) process.stdout.write(text); });
    child.stderr.on("data", (chunk) => { const text = String(chunk); stderr += text; if (!options.quiet) process.stderr.write(text); });
    if (options.input) child.stdin.end(options.input); else child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(Object.assign(new Error(`${command} ${commandArgs.join(" ")} falhou (${code})`), { stdout, stderr, code })));
  });
}

async function wrangler(...commandArgs) {
  return run(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", ...commandArgs], { cwd: cf });
}

async function ensureQueue(name) {
  try { await wrangler("queues", "create", name); }
  catch (error) {
    const text = `${error.stdout || ""}\n${error.stderr || ""}`.toLowerCase();
    if (!text.includes("already") && !text.includes("exists")) throw error;
    console.log(`✓ Queue ${name} já existe`);
  }
}

function findRestoreFile() {
  const explicit = args.get("restore");
  const candidates = [explicit, resolve(root, "CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql"), resolve(root, "..", "CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql"), resolve(process.cwd(), "CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql")].filter(Boolean).map(String);
  return candidates.find((file) => existsSync(file)) || null;
}

console.log("\nCORVO LIBRARY V2 — INSTALAÇÃO RÁPIDA CLOUDFLARE\n");
console.log("1/8 Instalando dependências do Core…");
await run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: cf });

console.log("2/8 Confirmando login Cloudflare…");
await wrangler("whoami");

console.log("3/8 D1…");
let d1List = await wrangler("d1", "list", "--json");
let databases = JSON.parse(d1List.stdout.trim() || "[]");
let database = databases.find((item) => item.name === names.d1);
if (!database) {
  await wrangler("d1", "create", names.d1);
  d1List = await wrangler("d1", "list", "--json");
  databases = JSON.parse(d1List.stdout.trim() || "[]");
  database = databases.find((item) => item.name === names.d1);
}
if (!database?.uuid) throw new Error(`Não foi possível localizar o UUID do D1 ${names.d1}.`);
console.log(`✓ D1 ${names.d1} · ${database.uuid}`);

console.log("4/8 R2…");
const r2List = await wrangler("r2", "bucket", "list");
if (!r2List.stdout.includes(names.r2)) throw new Error(`Bucket R2 ${names.r2} não encontrado. A V2 não cria outro bucket automaticamente para evitar duplicar sua mídia.`);
console.log(`✓ R2 existente ${names.r2}`);

console.log("5/8 Queue + DLQ…");
await ensureQueue(names.queue);
await ensureQueue(names.dlq);

console.log("6/8 Gerando bindings e secrets…");
const source = resolve(cf, "wrangler.jsonc.example");
const target = resolve(cf, "wrangler.jsonc");
let config = await readFile(source, "utf8");
config = config.replace("REPLACE_WITH_D1_DATABASE_ID", database.uuid).replaceAll("corvoquiz-prod", names.r2).replaceAll("corvo-materialize-v2-dlq", names.dlq).replaceAll("corvo-materialize-v2", names.queue);
await writeFile(target, config, "utf8");
const internalKey = randomBytes(32).toString("base64url");
const signingKey = randomBytes(32).toString("base64url");
await run(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "secret", "put", "CORVO_INTERNAL_KEY", "--config", "wrangler.jsonc"], { cwd: cf, input: `${internalKey}\n` });
await run(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "secret", "put", "CORVO_SIGNING_KEY", "--config", "wrangler.jsonc"], { cwd: cf, input: `${signingKey}\n` });

console.log("7/8 Banco…");
const restoreFile = findRestoreFile();
if (restoreFile) {
  console.log(`Restaurando snapshot seguro: ${restoreFile}`);
  await wrangler("d1", "execute", names.d1, "--remote", "--file", restoreFile, "--config", "wrangler.jsonc");
} else {
  console.warn("⚠ CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql não encontrado ao lado do projeto. O Core será publicado, mas o catálogo histórico ainda precisará ser restaurado uma vez.");
}
await wrangler("d1", "migrations", "apply", names.d1, "--remote", "--config", "wrangler.jsonc");

console.log("8/8 Publicando Worker…");
const deployment = await wrangler("deploy", "--config", "wrangler.jsonc");
const coreUrl = deployment.stdout.match(/https:\/\/[^\s]+\.workers\.dev\/?/i)?.[0]?.replace(/\/$/, "") || "https://<seu-worker>.workers.dev";

console.log("\n✅ CLOUDFLARE CORE PRONTO\n");
console.log("Agora adicione SOMENTE estas duas variáveis persistentes no projeto Vercel corvo-library-v2:\n");
console.log(`CORVO_CORE_URL=${coreUrl}`);
console.log(`CORVO_INTERNAL_KEY=${internalKey}`);
console.log("\nCORVO_SIGNING_KEY ficou somente no Worker e não deve ir para a Vercel.");
console.log("Depois, volte em Configurações → Verificar e travar.\n");
