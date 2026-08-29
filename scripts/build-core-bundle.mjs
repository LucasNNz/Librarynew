import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, ".generated", "corvo-core-v2.mjs");
await build({
  entryPoints: [path.join(root, "cloudflare", "src", "index.ts")],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "module", "import"],
  // Node built-ins used by the Agents/MCP SDK are runtime-provided by
  // Cloudflare Workers for our compatibility date. Do not ask Vercel
  // esbuild to resolve/polyfill them while embedding the Worker bundle.
  external: ["node:*"],
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
const source = await readFile(out, "utf8");
const target = path.join(root, "lib", "generated-core-bundle.ts");
await writeFile(target, `// AUTO-GENERATED. DO NOT EDIT.\nexport const CORE_WORKER_BUNDLE_VERSION = \"0.12.1\";\nexport const CORE_WORKER_BUNDLE = ${JSON.stringify(source)};\n`, "utf8");
console.log(`Core Worker bundle embedded: ${source.length} bytes`);
