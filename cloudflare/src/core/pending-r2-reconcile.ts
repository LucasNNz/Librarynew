import type { Env } from "../types";
import { deletePendingAssetsPermanently } from "./asset-ops";
import { refreshRecoveryAfterWrite, writeAssetRecoveryRecord } from "./recovery-manifest";

type PendingAsset = {
  id: string;
  name: string;
  universe: string;
  subject: string | null;
  r2_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  operational_note: string | null;
};

type BucketObject = {
  key: string;
  size: number;
  uploaded: string;
  etag: string;
  customMetadata: Record<string, string>;
};

type MaterializedRow = {
  r2_key: string;
  sha256: string | null;
  size_bytes: number | null;
};

type Match = {
  key: string;
  size: number;
  score: number;
  confidence: "EXACT" | "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  autoRepairable: boolean;
};

function basename(key: string) {
  const clean = String(key || "").replace(/\\/g, "/");
  return clean.slice(clean.lastIndexOf("/") + 1);
}

function stem(value: string) {
  const base = basename(value);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extension(value: string) {
  const base = basename(value).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : "";
}

function canonical(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function scanBucket(env: Env, maxObjects: number) {
  const objects: BucketObject[] = [];
  let cursor: string | undefined;
  do {
    const remaining = maxObjects - objects.length;
    if (remaining <= 0) break;
    const page = await env.MEDIA.list({
      limit: Math.min(1000, remaining),
      cursor,
      include: ["customMetadata"],
    });
    for (const object of page.objects) {
      objects.push({
        key: object.key,
        size: Number(object.size || 0),
        uploaded: object.uploaded.toISOString(),
        etag: object.httpEtag,
        customMetadata: ((object as unknown as { customMetadata?: Record<string, string> }).customMetadata || {}),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < maxObjects);
  return { objects, truncated: Boolean(cursor) };
}

function rankCandidate(asset: PendingAsset, object: BucketObject, materializedKeys: Set<string>) {
  const reasons: string[] = [];
  let score = 0;
  const assetId = asset.id.toLowerCase();
  const keyLower = object.key.toLowerCase();
  const objectBase = basename(object.key);
  const originalBase = basename(asset.original_name || asset.r2_key);
  const objectStem = canonical(stem(objectBase));
  const originalStem = canonical(stem(originalBase));
  const assetName = canonical(asset.name);
  const metadataSha = String(object.customMetadata?.sha256 || object.customMetadata?.hash || "").toLowerCase();
  const assetSha = String(asset.sha256 || "").toLowerCase();

  if (assetSha && metadataSha && assetSha === metadataSha) {
    score += 150;
    reasons.push("SHA256_EXATO");
  }
  if (materializedKeys.has(object.key)) {
    score += 130;
    reasons.push("SHA256_NO_HISTORICO_D1");
  }
  if (keyLower.includes(assetId)) {
    score += 110;
    reasons.push("ASSET_ID_NA_CHAVE");
  }
  if (originalBase && objectBase.toLowerCase() === originalBase.toLowerCase()) {
    score += 65;
    reasons.push("NOME_ARQUIVO_EXATO");
  }
  if (asset.size_bytes > 0 && object.size === Number(asset.size_bytes)) {
    score += 30;
    reasons.push("TAMANHO_EXATO");
  }
  if (originalStem && objectStem === originalStem) {
    score += 25;
    reasons.push("NOME_NORMALIZADO_EXATO");
  }
  if (extension(objectBase) && extension(objectBase) === extension(originalBase)) {
    score += 5;
    reasons.push("EXTENSAO_COMPATIVEL");
  }
  if (assetName && objectStem && (objectStem.includes(assetName) || assetName.includes(objectStem))) {
    score += 10;
    reasons.push("NOME_ASSET_COMPATIVEL");
  }

  const confidence: Match["confidence"] = score >= 140 ? "EXACT" : score >= 100 ? "HIGH" : score >= 75 ? "MEDIUM" : "LOW";
  return { score, reasons, confidence };
}

async function analyzePending(env: Env, maxObjects = 20000, limit = 500) {
  const pendingResult = await env.DB.prepare(`SELECT id,name,universe,subject,r2_key,original_name,mime_type,size_bytes,sha256,operational_note
    FROM assets WHERE status LIKE 'Pendente%' ORDER BY updated_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 1000))).all<PendingAsset>();
  const pending = pendingResult.results || [];
  const inventory = await scanBucket(env, Math.max(1000, Math.min(maxObjects, 50000)));
  const objectsByKey = new Map(inventory.objects.map(object => [object.key, object]));
  const byBasename = new Map<string, BucketObject[]>();
  const byStem = new Map<string, BucketObject[]>();
  const bySize = new Map<number, BucketObject[]>();
  const byMetadataSha = new Map<string, BucketObject[]>();
  const byAssetId = new Map<string, BucketObject[]>();
  const pushIndex = <K,>(map: Map<K, BucketObject[]>, key: K, object: BucketObject) => map.set(key, [...(map.get(key) || []), object]);
  for (const object of inventory.objects) {
    pushIndex(byBasename, basename(object.key).toLowerCase(), object);
    const normalizedStem = canonical(stem(object.key));
    if (normalizedStem) pushIndex(byStem, normalizedStem, object);
    pushIndex(bySize, object.size, object);
    const metadataSha = String(object.customMetadata?.sha256 || object.customMetadata?.hash || "").toLowerCase();
    if (metadataSha) pushIndex(byMetadataSha, metadataSha, object);
    for (const segment of object.key.split("/")) if (/^AST-/i.test(segment)) pushIndex(byAssetId, segment.toLowerCase(), object);
  }

  const shaValues = [...new Set(pending.map(item => String(item.sha256 || "").trim().toLowerCase()).filter(Boolean))];
  const shaValueSet = new Set(shaValues);
  const materializedBySha = new Map<string, Set<string>>();
  if (shaValues.length) {
    // Avoid dynamic placeholder explosions: the historical table is small enough
    // to read once, and matching remains entirely in-memory/read-only.
    const materialized = await env.DB.prepare(`SELECT r2_key,sha256,size_bytes FROM materialization_files
      WHERE sha256 IS NOT NULL AND TRIM(sha256)<>'' AND r2_key IS NOT NULL AND TRIM(r2_key)<>''`)
      .all<MaterializedRow>();
    for (const row of materialized.results || []) {
      const hash = String(row.sha256 || "").toLowerCase();
      if (!hash || !shaValueSet.has(hash)) continue;
      const set = materializedBySha.get(hash) || new Set<string>();
      set.add(row.r2_key);
      materializedBySha.set(hash, set);
    }
  }

  let present = 0;
  let repairable = 0;
  let unresolved = 0;
  let probable = 0;

  const items = pending.map(asset => {
    const current = objectsByKey.get(asset.r2_key);
    if (current) {
      present += 1;
      return {
        assetId: asset.id,
        name: asset.name,
        universe: asset.universe,
        subject: asset.subject,
        currentR2Key: asset.r2_key,
        originalName: asset.original_name,
        expectedBytes: Number(asset.size_bytes || 0),
        state: "FOUND_CURRENT" as const,
        bestMatch: { key: current.key, size: current.size, score: 999, confidence: "EXACT" as const, reasons: ["R2_KEY_ATUAL_EXISTE"], autoRepairable: false },
        alternatives: [] as Match[],
      };
    }

    const assetSha = String(asset.sha256 || "").toLowerCase();
    const shaKeys = materializedBySha.get(assetSha) || new Set<string>();
    const candidateMap = new Map<string, BucketObject>();
    const add = (list: BucketObject[] | undefined) => { for (const object of list || []) candidateMap.set(object.key, object); };
    add(byAssetId.get(asset.id.toLowerCase()));
    add(byBasename.get(basename(asset.original_name || asset.r2_key).toLowerCase()));
    add(byStem.get(canonical(stem(asset.original_name || asset.r2_key))));
    add(byStem.get(canonical(asset.name)));
    if (asset.size_bytes > 0) add(bySize.get(Number(asset.size_bytes)));
    if (assetSha) add(byMetadataSha.get(assetSha));
    for (const key of shaKeys) { const object = objectsByKey.get(key); if (object) candidateMap.set(key, object); }

    const ranked = [...candidateMap.values()]
      .map(object => ({ object, ...rankCandidate(asset, object, shaKeys) }))
      .filter(candidate => candidate.score >= 55)
      .sort((a, b) => b.score - a.score || a.object.key.localeCompare(b.object.key))
      .slice(0, 5);

    const best = ranked[0];
    const runnerUp = ranked[1];
    const uniqueLead = !runnerUp || best.score - runnerUp.score >= 20;
    const autoRepairable = Boolean(best && uniqueLead && (
      best.reasons.includes("SHA256_EXATO") ||
      best.reasons.includes("SHA256_NO_HISTORICO_D1") ||
      best.reasons.includes("ASSET_ID_NA_CHAVE") ||
      (best.reasons.includes("NOME_ARQUIVO_EXATO") && best.reasons.includes("TAMANHO_EXATO"))
    ));

    if (best && autoRepairable) repairable += 1;
    else if (best) probable += 1;
    else unresolved += 1;

    const toMatch = (candidate: typeof ranked[number]): Match => ({
      key: candidate.object.key,
      size: candidate.object.size,
      score: candidate.score,
      confidence: candidate.confidence,
      reasons: candidate.reasons,
      autoRepairable: candidate.object.key === best?.object.key ? autoRepairable : false,
    });

    return {
      assetId: asset.id,
      name: asset.name,
      universe: asset.universe,
      subject: asset.subject,
      currentR2Key: asset.r2_key,
      originalName: asset.original_name,
      expectedBytes: Number(asset.size_bytes || 0),
      state: best ? (autoRepairable ? "FOUND_ALTERNATE" as const : "POSSIBLE_MATCH" as const) : "NOT_FOUND" as const,
      bestMatch: best ? toMatch(best) : null,
      alternatives: ranked.slice(1).map(toMatch),
    };
  });

  return {
    pending: pending.length,
    scannedObjects: inventory.objects.length,
    inventoryTruncated: inventory.truncated,
    present,
    repairable,
    probable,
    unresolved,
    items,
    readOnly: true,
  };
}

export async function scanPendingMedia(request: Request, env: Env) {
  const url = new URL(request.url);
  return analyzePending(
    env,
    Number(url.searchParams.get("maxObjects") || 20000),
    Number(url.searchParams.get("limit") || 500),
  );
}

export async function repairPendingMedia(env: Env, input: { assetIds?: string[]; maxObjects?: number }) {
  const analysis = await analyzePending(env, input.maxObjects || 20000, 1000);
  const requested = new Set((input.assetIds || []).map(String).filter(Boolean));
  const candidates = analysis.items.filter(item =>
    item.state === "FOUND_ALTERNATE" &&
    item.bestMatch?.autoRepairable &&
    (!requested.size || requested.has(item.assetId))
  );

  const repaired: Array<{ assetId: string; previousR2Key: string; r2Key: string }> = [];
  const skipped: Array<{ assetId: string; reason: string }> = [];
  for (const item of candidates) {
    const latest = await env.DB.prepare("SELECT status,r2_key,operational_note FROM assets WHERE id=?")
      .bind(item.assetId).first<{ status: string; r2_key: string; operational_note: string | null }>();
    if (!latest || !String(latest.status).toLowerCase().startsWith("pendente")) {
      skipped.push({ assetId: item.assetId, reason: "NOT_PENDING_ANYMORE" });
      continue;
    }
    if (latest.r2_key && await env.MEDIA.head(latest.r2_key)) {
      skipped.push({ assetId: item.assetId, reason: "CURRENT_KEY_NOW_EXISTS" });
      continue;
    }
    const best = item.bestMatch;
    if (!best || !best.autoRepairable || !(await env.MEDIA.head(best.key))) {
      skipped.push({ assetId: item.assetId, reason: "MATCH_NOT_AVAILABLE" });
      continue;
    }
    const note = [latest.operational_note, `V2 R2 reconcile: ${latest.r2_key} -> ${best.key} (${best.reasons.join(",")})`]
      .filter(Boolean).join("\n");
    await env.DB.prepare("UPDATE assets SET r2_key=?,size_bytes=?,operational_note=?,updated_at=? WHERE id=? AND status LIKE 'Pendente%'")
      .bind(best.key, best.size, note, Date.now(), item.assetId).run();
    await writeAssetRecoveryRecord(env,item.assetId,"R2_RELINKED").catch(() => undefined);
    repaired.push({ assetId: item.assetId, previousR2Key: latest.r2_key, r2Key: best.key });
  }

  if (repaired.length) await refreshRecoveryAfterWrite(env,"PENDING_R2_RELINKED",String(repaired.length)).catch(() => undefined);
  return {
    requested: requested.size || candidates.length,
    eligible: candidates.length,
    repaired: repaired.length,
    repairedItems: repaired,
    skipped,
    statusPreserved: "Pendente",
  };
}

export async function deleteMissingPendingMedia(env: Env, input: { confirm?: boolean; maxObjects?: number }) {
  if (!input.confirm) return { error:"CONFIRM_REQUIRED", status:400 } as const;
  // Re-scan immediately before destructive action so an old browser result can never be the deletion authority.
  const analysis = await analyzePending(env, input.maxObjects || 20000, 1000);
  if (analysis.inventoryTruncated) return { error:"R2_INVENTORY_TRUNCATED", detail:"A exclusão foi bloqueada porque a varredura não cobriu todo o bucket.", status:409 } as const;
  const missing = analysis.items.filter(item => item.state === "NOT_FOUND").map(item => item.assetId);
  const deleted = await deletePendingAssetsPermanently(env,missing,true);
  return {
    scannedPending: analysis.pending,
    scannedObjects: analysis.scannedObjects,
    notFound: missing.length,
    ...deleted,
    policy:"DISCARD_AND_RECAPTURE",
    freshScanRequired:true,
  };
}
