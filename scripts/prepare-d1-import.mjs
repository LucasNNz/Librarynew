import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Uso: node scripts/prepare-d1-import.mjs <database.sql> <safe.sql>");
  process.exit(2);
}

const source = await readFile(input, "utf8");
const sensitiveSettingKeys = new Set([
  "mcp_connection_code",
  "secret_cloudflare_connection",
  "secret_supervisor_connection",
]);

const lines = source.split(/\r?\n/);
const safe = [];
let removedSecrets = 0;
let removedTransactionWrappers = 0;
let retainedRedactions = 0;
for (const line of lines) {
  const trimmed = line.trim();
  if (/^BEGIN TRANSACTION;?$/i.test(trimmed) || /^COMMIT;?$/i.test(trimmed)) {
    removedTransactionWrappers += 1;
    continue;
  }
  const settingMatch = line.match(/^INSERT INTO ["`]settings["`].*?VALUES \('([^']+)'/i);
  if (settingMatch && sensitiveSettingKeys.has(settingMatch[1])) {
    removedSecrets += 1;
    continue;
  }
  if (line.includes("[REDACTED_SECRET]") && !trimmed.startsWith("--")) {
    // O backup histórico já foi sanitizado em campos que podiam conter URLs/detalhes
    // sensíveis. Esses marcadores são dados inertes e podem ser preservados.
    // As únicas linhas que davam acesso a infraestrutura são removidas acima.
    retainedRedactions += 1;
  }
  safe.push(line);
}

const text = safe.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
await writeFile(output, text, "utf8");
const sha256 = createHash("sha256").update(text).digest("hex");
console.log(JSON.stringify({
  input,
  output,
  removedSecrets,
  removedTransactionWrappers,
  retainedRedactions,
  bytes: Buffer.byteLength(text),
  sha256,
}, null, 2));
