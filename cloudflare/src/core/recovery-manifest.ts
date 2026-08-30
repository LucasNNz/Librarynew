import type { Env } from "../types";
import { nowMs } from "./ids";

const STRUCTURE_KEY = "corvo-core/recovery/D1_STRUCTURE.json";
const ASSET_PREFIX = "corvo-core/recovery/assets/";
const CANDIDATE_PREFIX = "corvo-core/recovery/candidates/";
const IMPORT_PREFIX = "corvo-core/recovery/imports/";
const DELETED_ASSET_PREFIX = "corvo-core/recovery/deleted/assets/";

function clean(value: unknown) { return String(value ?? "").trim(); }

async function putJson(env: Env, key: string, value: unknown, metadata: Record<string,string> = {}) {
  const body = JSON.stringify(value, null, 2);
  await env.MEDIA.put(key, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
    customMetadata: { corvoRecovery: "1", ...metadata },
  });
  return { key, bytes: new TextEncoder().encode(body).byteLength };
}

export async function writeD1StructureManifest(env: Env, trigger: string, reference?: string | null) {
  const [schema, meta, counts] = await Promise.all([
    env.DB.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
      WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 1 ELSE 2 END,name`).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT key,value,updated_at FROM v2_schema_meta ORDER BY key").all<Record<string,unknown>>().catch(() => ({ results: [], success:true, meta:{} } as unknown as D1Result<Record<string,unknown>>)),
    env.DB.batch<Record<string,unknown>>([
      env.DB.prepare("SELECT COUNT(*) AS count FROM assets"),
      env.DB.prepare("SELECT COUNT(*) AS count FROM imports"),
      env.DB.prepare("SELECT COUNT(*) AS count FROM v2_ingest_candidates"),
    ]),
  ]);
  const payload = {
    format: "CORVO_D1_STRUCTURE_V1",
    generated_at: new Date().toISOString(),
    trigger,
    reference: reference || null,
    purpose: "Permite reconstruir a estrutura lógica do D1 lendo somente o R2. Dados de mídia possuem sidecars JSON em corvo-core/recovery/.",
    recovery: {
      structure_key: STRUCTURE_KEY,
      asset_sidecars_prefix: ASSET_PREFIX,
      candidate_sidecars_prefix: CANDIDATE_PREFIX,
      import_sidecars_prefix: IMPORT_PREFIX,
      deleted_asset_tombstones_prefix: DELETED_ASSET_PREFIX,
      primary_asset_table: "assets",
      primary_asset_key: "id",
      r2_pointer_field: "r2_key",
      tags_encoding: "JSON array armazenado como TEXT",
      secret_policy: "Nenhum segredo/token deve aparecer nestes manifestos.",
    },
    counts: {
      assets: Number(counts[0]?.results?.[0]?.count || 0),
      imports: Number(counts[1]?.results?.[0]?.count || 0),
      candidates: Number(counts[2]?.results?.[0]?.count || 0),
    },
    schema_meta: meta.results || [],
    sqlite_schema: (schema.results || []).map(row => ({ type: row.type, name: row.name, table: row.tbl_name, sql: row.sql })),
  };
  const stored = await putJson(env, STRUCTURE_KEY, payload, { kind: "d1-structure", trigger: clean(trigger).slice(0,80) });
  await env.DB.prepare(`INSERT INTO v2_recovery_events (id,event_type,entity_type,entity_id,r2_key,created_at)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?)`).bind("STRUCTURE_REFRESH","D1",reference || null,stored.key,nowMs()).run().catch(() => undefined);
  return stored;
}

export async function writeAssetRecoveryRecord(env: Env, assetId: string, event = "ASSET_WRITE") {
  const row = await env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first<Record<string,unknown>>();
  if (!row) return null;
  const key = `${ASSET_PREFIX}${encodeURIComponent(assetId)}.json`;
  const payload = {
    format: "CORVO_ASSET_RECOVERY_V1",
    generated_at: new Date().toISOString(),
    event,
    d1_contract: {
      table: "assets",
      primary_key: "id",
      r2_pointer_field: "r2_key",
      tags_encoding: "JSON_TEXT",
      rebuild_rule: "Inserir/atualizar a linha abaixo preservando id e r2_key. O arquivo físico permanece no bucket indicado por r2_key.",
    },
    row,
  };
  const stored = await putJson(env,key,payload,{kind:"asset",assetId,event:clean(event).slice(0,60)});
  await env.DB.prepare(`INSERT INTO v2_recovery_events (id,event_type,entity_type,entity_id,r2_key,created_at)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?)`).bind(event,"ASSET",assetId,key,nowMs()).run().catch(() => undefined);
  return stored;
}


export async function writeAssetDeletionTombstone(env: Env, asset: Record<string,unknown>, reason = "PERMANENT_DELETE") {
  const assetId = clean(asset.id);
  if (!assetId) return null;
  const key = `${DELETED_ASSET_PREFIX}${encodeURIComponent(assetId)}.json`;
  const payload = {
    format: "CORVO_ASSET_DELETION_TOMBSTONE_V1",
    deleted_at: new Date().toISOString(),
    reason,
    restore_policy: "DO_NOT_RESTORE",
    asset: {
      id: asset.id, name: asset.name, universe: asset.universe, subject: asset.subject,
      status: asset.status, r2_key: asset.r2_key, original_name: asset.original_name,
      size_bytes: asset.size_bytes, sha256: asset.sha256,
    },
    note: "Este registro foi excluído permanentemente de propósito. Uma reconstrução a partir do R2 não deve recriá-lo.",
  };
  const stored = await putJson(env,key,payload,{kind:"asset-deletion",assetId,reason:clean(reason).slice(0,60)});
  await env.DB.prepare(`INSERT INTO v2_recovery_events (id,event_type,entity_type,entity_id,r2_key,created_at)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?)`).bind("ASSET_PERMANENTLY_DELETED","ASSET",assetId,key,nowMs()).run().catch(() => undefined);
  return stored;
}

export async function deleteAssetRecoveryRecord(env: Env, assetId: string) {
  await env.MEDIA.delete(`${ASSET_PREFIX}${encodeURIComponent(assetId)}.json`).catch(() => undefined);
}

export async function writeCandidateRecoveryRecord(env: Env, candidateId: string, event = "CANDIDATE_WRITE") {
  const row = await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(candidateId).first<Record<string,unknown>>();
  if (!row) return null;
  const key = `${CANDIDATE_PREFIX}${encodeURIComponent(candidateId)}.json`;
  const payload = {
    format: "CORVO_CANDIDATE_RECOVERY_V1",
    generated_at: new Date().toISOString(),
    event,
    d1_contract: { table:"v2_ingest_candidates", primary_key:"id", r2_pointer_field:"r2_key" },
    row,
  };
  const stored = await putJson(env,key,payload,{kind:"candidate",candidateId,event:clean(event).slice(0,60)});
  await env.DB.prepare(`INSERT INTO v2_recovery_events (id,event_type,entity_type,entity_id,r2_key,created_at)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?)`).bind(event,"CANDIDATE",candidateId,key,nowMs()).run().catch(() => undefined);
  return stored;
}

export async function writeImportRecoveryRecord(env: Env, importId: string, event = "IMPORT_WRITE") {
  const row = await env.DB.prepare("SELECT * FROM imports WHERE id=?").bind(importId).first<Record<string,unknown>>();
  if (!row) return null;
  const linked = await env.DB.prepare("SELECT id,name,universe,status,r2_key,original_name,size_bytes,sha256 FROM assets WHERE operational_note LIKE ? ORDER BY created_at")
    .bind(`%${importId}%`).all<Record<string,unknown>>().catch(() => ({ results: [], success:true, meta:{} } as unknown as D1Result<Record<string,unknown>>));
  const key = `${IMPORT_PREFIX}${encodeURIComponent(importId)}.json`;
  const payload = {
    format: "CORVO_IMPORT_RECOVERY_V1",
    generated_at: new Date().toISOString(),
    event,
    d1_contract: { table:"imports", primary_key:"id", r2_pointer_field:"r2_key" },
    row,
    note: "Assets importados possuem sidecars individuais em corvo-core/recovery/assets/.",
    sampled_assets: (linked.results || []).slice(0,100),
  };
  const stored = await putJson(env,key,payload,{kind:"import",importId,event:clean(event).slice(0,60)});
  await env.DB.prepare(`INSERT INTO v2_recovery_events (id,event_type,entity_type,entity_id,r2_key,created_at)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?)`).bind(event,"IMPORT",importId,key,nowMs()).run().catch(() => undefined);
  return stored;
}

export async function refreshRecoveryAfterWrite(env: Env, trigger: string, reference?: string | null) {
  return writeD1StructureManifest(env,trigger,reference).catch(() => null);
}
