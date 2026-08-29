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
  platform: "browser",
  target: "es2022",
  conditions: ["workerd", "worker", "browser", "module", "import"],
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
const source = await readFile(out, "utf8");
const target = path.join(root, "lib", "generated-core-bundle.ts");
await writeFile(target, `// AUTO-GENERATED. DO NOT EDIT.\nexport const CORE_WORKER_BUNDLE_VERSION = \"0.12.0\";\nexport const CORE_WORKER_BUNDLE = ${JSON.stringify(source)};\n`, "utf8");
console.log(`Core Worker bundle embedded: ${source.length} bytes`);
