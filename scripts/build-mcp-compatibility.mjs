import { readFile, writeFile } from "node:fs/promises";

const [legacyFile, currentFile, outputFile] = process.argv.slice(2);
if (!legacyFile || !currentFile || !outputFile) {
  console.error("Uso: node scripts/build-mcp-compatibility.mjs <legacy-mcp-tools.ts> <v2-mcp.ts> <out.md>");
  process.exit(2);
}

const legacy = await readFile(legacyFile, "utf8");
const current = await readFile(currentFile, "utf8");
const legacyNames = [...legacy.matchAll(/\btool\(\s*["']([^"']+)["']/g)].map(match => match[1]);
const currentNames = new Set([...current.matchAll(/registerTool\(\s*["']([^"']+)["']/g)].map(match => match[1]));
const replaced = new Map([
  ["obter_configuracao_cloudflare", "Substituído por diagnóstico de bindings; nenhuma credencial R2 fica no D1."],
  ["configurar_cloudflare", "Substituído por bindings Cloudflare gerenciados fora do app."],
]);

function category(index) {
  const n = index + 1;
  if (n <= 15) return "Catálogo";
  if (n <= 28) return "Solicitações / lotes / importações";
  if (n <= 76) return "FAST PUSH / produção / entrega";
  if (n <= 98) return "Materialização";
  if (n <= 105) return "Estoque / telemetria";
  if (n <= 123) return "Workers / dispatcher";
  if (n <= 161) return "Supervisor / perfis";
  if (n <= 205) return "Projetos automáticos / políticas / planos";
  if (n <= 215) return "Coleta automática";
  if (n <= 219) return "Configurações";
  return "Operação rápida / diagnóstico";
}

const rows = legacyNames.map((name, index) => {
  const status = currentNames.has(name) ? "✅ IMPLEMENTADO" : replaced.has(name) ? "🔁 SUBSTITUÍDO" : "⬜ PLANEJADO";
  const note = currentNames.has(name) ? "Nome histórico preservado no MCP V2." : replaced.get(name) || "Será portado sobre os serviços V2, sem copiar a infraestrutura legada.";
  return { name, category: category(index), status, note };
});
const implemented = rows.filter(row => row.status.includes("IMPLEMENTADO")).length;
const substituted = rows.filter(row => row.status.includes("SUBSTITUÍDO")).length;
const planned = rows.length - implemented - substituted;

const body = `# Compatibilidade MCP — Corvo Library V2\n\n` +
`Fonte de referência: catálogo MCP da V61.9. A V2 preserva nomes de ferramentas sempre que a semântica continua válida, mas a implementação interna usa D1 + R2 + Queue/Worker.\n\n` +
`## Progresso\n\n- Ferramentas históricas: **${rows.length}**\n- Implementadas na V2: **${implemented}**\n- Substituídas por arquitetura mais segura: **${substituted}**\n- Planejadas: **${planned}**\n\n` +
`> Regra: \`IMPLEMENTADO\` significa que existe um registro MCP V2 com o mesmo nome. Equivalência comportamental completa ainda será validada por testes de contrato por fase.\n\n` +
`| # | Ferramenta | Área | Estado | Observação |\n|---:|---|---|---|---|\n` +
rows.map((row, index) => `| ${index + 1} | \`${row.name}\` | ${row.category} | ${row.status} | ${row.note} |`).join("\n") + "\n";

await writeFile(outputFile, body, "utf8");
console.log(JSON.stringify({ historical: rows.length, implemented, substituted, planned, outputFile }, null, 2));
