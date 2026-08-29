import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const databaseId = process.argv[2]?.trim();
if (!databaseId) {
  console.error("Uso: node scripts/render-wrangler.mjs <D1_DATABASE_ID>");
  process.exit(2);
}
if (!/^[a-zA-Z0-9-]{8,}$/.test(databaseId)) {
  console.error("D1_DATABASE_ID inválido.");
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "cloudflare/wrangler.jsonc.example");
const target = resolve(root, "cloudflare/wrangler.jsonc");
const text = (await readFile(source, "utf8")).replace("REPLACE_WITH_D1_DATABASE_ID", databaseId);
if (text.includes("REPLACE_WITH_D1_DATABASE_ID")) throw new Error("Placeholder de D1 não foi substituído.");
await writeFile(target, text, "utf8");
console.log(JSON.stringify({ ok: true, target, databaseId }, null, 2));
