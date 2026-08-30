import type { Env } from "../types";
import { catalogAsset } from "./asset-ops";
import { nowMs } from "./ids";
import { refreshRecoveryAfterWrite, writeAssetRecoveryRecord } from "./recovery-manifest";

type AssetRef = { id:string; r2_key:string; sha256:string|null };
type R2Lite = { key:string; size:number };

function clean(value: unknown) { return String(value ?? "").trim(); }
function parseAssetId(key: string) {
  const match = key.match(/^assets\/(AST-[A-F0-9]{16,64})\//i);
  return match ? match[1].toUpperCase() : null;
}
function guessMime(key: string) {
  const ext = (key.split(".").pop() || "").toLowerCase();
  return ({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", avif:"image/avif", svg:"image/svg+xml", mp4:"video/mp4", webm:"video/webm", mov:"video/quicktime", m4v:"video/x-m4v" } as Record<string,string>)[ext] || "application/octet-stream";
}
function defaultKind(mime: string) { return mime.startsWith("video/") ? "Vídeo" : mime === "image/gif" ? "GIF" : "Imagem"; }

async function listAssetsPrefix(env: Env, maxObjects: number) {
  const objects: R2Lite[] = [];
  let cursor: string | undefined;
  do {
    const remaining = maxObjects - objects.length;
    if (remaining <= 0) break;
    const page = await env.MEDIA.list({ prefix:"assets/", limit:Math.min(1000, remaining), cursor });
    for (const object of page.objects) objects.push({ key:object.key, size:Number(object.size || 0) });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < maxObjects);
  return { objects, truncated:Boolean(cursor) };
}

export async function reconcileR2Catalog(env: Env, input: { repair?:boolean; maxObjects?:number; maxRepairs?:number } = {}) {
  const maxObjects = Math.max(1000, Math.min(Number(input.maxObjects || 20000), 50000));
  const maxRepairs = Math.max(1, Math.min(Number(input.maxRepairs || 250), 1000));
  const [inventory, refsResult] = await Promise.all([
    listAssetsPrefix(env, maxObjects),
    env.DB.prepare("SELECT id,r2_key,sha256 FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''").all<AssetRef>(),
  ]);
  const refs = refsResult.results || [];
  const r2Keys = new Set(inventory.objects.map(item => item.key));
  const refsByKey = new Map(refs.map(row => [row.r2_key, row]));
  const uncataloged = inventory.objects.filter(object => !refsByKey.has(object.key));
  const missing = refs.filter(row => !r2Keys.has(row.r2_key));
  const repaired: Array<{assetId:string;key:string;mode:string}> = [];
  const warnings: string[] = [];

  if (input.repair) {
    for (const object of uncataloged.slice(0, maxRepairs)) {
      try {
        const head = await env.MEDIA.head(object.key);
        if (!head) continue;
        const custom = head.customMetadata || {};
        const assetId = clean(custom.corvoAssetId) || parseAssetId(object.key);
        if (!assetId) { warnings.push(`${object.key}: ASSET_ID_NOT_RECOVERABLE`); continue; }
        const existing = await env.DB.prepare("SELECT id FROM assets WHERE id=? OR r2_key=? LIMIT 1").bind(assetId, object.key).first();
        if (existing) continue;
        const fileName = clean(custom.corvoOriginal) || object.key.split("/").pop() || "arquivo";
        const mime = clean(head.httpMetadata?.contentType) || guessMime(fileName);
        const qa = clean(custom.corvoQa).toUpperCase() || "RESSALVA";
        const classification = clean(custom.corvoClass).toUpperCase();
        const tags = ["r2-sincronizado"];
        if (classification) tags.push(`classificacao-${classification.toLocaleLowerCase("pt-BR").replace(/_/g, "-")}`);
        const created = await catalogAsset(new Request("https://corvo.local/r2-sync"), {
          asset_id:assetId,
          nome:clean(custom.corvoName) || fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          r2_key:object.key,
          arquivo_original:fileName,
          mime_type:mime,
          universo:clean(custom.corvoUniverse) || "Sem universo",
          tipo:clean(custom.corvoKind) || defaultKind(mime),
          sujeito:clean(custom.corvoSubject) || undefined,
          tags,
          nota_operacional:"Registro D1 reconstruído automaticamente a partir do metadata persistido no R2.",
          status_qa:qa,
          defer_recovery:true,
          compact_response:true,
        }, env);
        if (created && typeof created === "object" && "error" in created) throw new Error(String(created.error));
        const status = qa === "APROVADO" ? "Aprovado" : "Pendente";
        await env.DB.prepare("UPDATE assets SET status=?,qa_status=?,sha256=?,updated_at=? WHERE id=?")
          .bind(status, qa, clean(custom.corvoSha256) || null, nowMs(), assetId).run();
        await writeAssetRecoveryRecord(env, assetId, "R2_CATALOG_SYNC").catch(() => undefined);
        repaired.push({ assetId, key:object.key, mode:custom.corvoAssetId ? "R2_METADATA" : "PATH_FALLBACK" });
      } catch (error) {
        warnings.push(`${object.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (repaired.length) await refreshRecoveryAfterWrite(env, "R2_CATALOG_SYNC", repaired[repaired.length - 1].assetId);
  }

  const repairedKeys = new Set(repaired.map(item => item.key));
  const remainingUncataloged = uncataloged.filter(item => !repairedKeys.has(item.key));
  const stillUncataloged = remainingUncataloged.length;
  return {
    ok: !inventory.truncated && missing.length === 0 && (!input.repair ? uncataloged.length === 0 : stillUncataloged === 0),
    prefix:"assets/",
    scannedR2:inventory.objects.length,
    d1Assets:refs.length + repaired.length,
    referencedR2:inventory.objects.length - uncataloged.length + repaired.length,
    uncatalogedBefore:uncataloged.length,
    repaired:repaired.length,
    uncatalogedAfter:stillUncataloged,
    missingInR2:missing.length,
    inventoryTruncated:inventory.truncated,
    repairLimitReached:Boolean(input.repair && uncataloged.length > maxRepairs),
    repairedItems:repaired.slice(0, 100),
    uncataloged:remainingUncataloged.slice(0, 100),
    missing:missing.slice(0, 100),
    warnings:[...new Set(warnings)].slice(0, 100),
  };
}
