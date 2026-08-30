import type { Env, LegacyAssetRow } from "../types";
import { id, nowMs } from "./ids";
import { getAsset } from "./assets";
import { deleteAssetRecoveryRecord, refreshRecoveryAfterWrite, writeAssetDeletionTombstone, writeAssetRecoveryRecord } from "./recovery-manifest";

export type CatalogAssetInput = {
  asset_id?: string;
  nome: string;
  r2_key: string;
  arquivo_original: string;
  mime_type: string;
  universo?: string;
  tipo?: string;
  sujeito?: string;
  tags?: string[];
  projeto_origem?: string;
  referencia_roteiro?: string;
  referencia_visual?: string;
  fonte_url?: string;
  nota_operacional?: string;
  status_qa?: string;
  /** Internal bulk-write optimization: sidecar may be written by caller and master recovery refreshed once at batch end. */
  defer_recovery?: boolean;
  /** Internal bulk-write optimization: avoid reading/signing the full asset response when caller only needs success. */
  compact_response?: boolean;
};

export type UpdateAssetInput = {
  nome?: string;
  universo?: string;
  tipo?: string;
  sujeito?: string | null;
  tags?: string[];
  projeto_origem?: string | null;
  referencia_roteiro?: string | null;
  referencia_visual?: string | null;
  fonte_url?: string | null;
  nota_operacional?: string | null;
  status_qa?: string;
};

export type UsageInput = {
  asset_id: string;
  projeto: string;
  bloco?: string;
  preset?: string;
  slot?: string;
  funcao?: string;
  referencia_roteiro?: string;
  observacao?: string;
};

function compactTags(tags: string[] | undefined) {
  return [...new Set((tags || []).map(value => value.trim()).filter(Boolean))].slice(0, 80);
}

function nullable(value: string | null | undefined) {
  if (value == null) return null;
  const clean = String(value).trim();
  return clean || null;
}

export async function getAssetHistory(assetId: string, env: Env, limit = 500) {
  const result = await env.DB.prepare(
    "SELECT * FROM asset_usage WHERE asset_id=? ORDER BY used_at DESC LIMIT ?",
  ).bind(assetId, Math.max(1, Math.min(limit, 500))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function catalogAsset(request: Request, input: CatalogAssetInput, env: Env) {
  const assetId = input.asset_id?.trim() || id("AST");
  const r2Key = input.r2_key.trim();
  if (!input.nome.trim() || !r2Key || !input.arquivo_original.trim() || !input.mime_type.trim()) {
    return { error: "INVALID_INPUT", status: 400 as const };
  }
  if (await env.DB.prepare("SELECT id FROM assets WHERE id=?").bind(assetId).first()) {
    return { error: "ASSET_ID_EXISTS", status: 409 as const };
  }
  const object = await env.MEDIA.head(r2Key);
  if (!object) return { error: "R2_OBJECT_NOT_FOUND", status: 404 as const, r2Key };

  const timestamp = nowMs();
  const qaStatus = (input.status_qa || "NAO_AVALIADO").trim().toUpperCase();
  const status = qaStatus === "APROVADO" ? "Aprovado" : "Pendente";
  await env.DB.prepare(`INSERT INTO assets (
      id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,use_count,last_used_at,
      created_at,updated_at,subject,previous_status,project_origin,script_reference,visual_reference,source_url,
      operational_note,qa_status,sha256,semantic_family
    ) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?,?,?,?,?,?,?,NULL,NULL)`)
    .bind(
      assetId,
      input.nome.trim(),
      input.universo?.trim() || "Sem universo",
      input.tipo?.trim() || "Imagem",
      status,
      JSON.stringify(compactTags(input.tags)),
      r2Key,
      input.arquivo_original.trim(),
      input.mime_type.trim(),
      Number(object.size || 0),
      timestamp,
      timestamp,
      nullable(input.sujeito),
      null,
      nullable(input.projeto_origem),
      nullable(input.referencia_roteiro),
      nullable(input.referencia_visual),
      nullable(input.fonte_url),
      nullable(input.nota_operacional),
      qaStatus,
    ).run();
  if (!input.defer_recovery) {
    await writeAssetRecoveryRecord(env, assetId, "ASSET_CATALOGED").catch(() => undefined);
    await refreshRecoveryAfterWrite(env, "ASSET_CATALOGED", assetId);
  }
  if (input.compact_response) return { asset: { id:assetId } };
  return { asset: await getAsset(request, assetId, env) };
}

export async function updateAssetMetadata(request: Request, assetId: string, input: UpdateAssetInput, env: Env) {
  const current = await env.DB.prepare("SELECT id FROM assets WHERE id=?").bind(assetId).first();
  if (!current) return { error: "NOT_FOUND", status: 404 as const };

  const columns: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => { columns.push(`${column}=?`); values.push(value); };
  if (input.nome !== undefined) assign("name", input.nome.trim());
  if (input.universo !== undefined) assign("universe", input.universo.trim() || "Sem universo");
  if (input.tipo !== undefined) assign("kind", input.tipo.trim() || "Imagem");
  if (input.sujeito !== undefined) assign("subject", nullable(input.sujeito));
  if (input.tags !== undefined) assign("tags", JSON.stringify(compactTags(input.tags)));
  if (input.projeto_origem !== undefined) assign("project_origin", nullable(input.projeto_origem));
  if (input.referencia_roteiro !== undefined) assign("script_reference", nullable(input.referencia_roteiro));
  if (input.referencia_visual !== undefined) assign("visual_reference", nullable(input.referencia_visual));
  if (input.fonte_url !== undefined) assign("source_url", nullable(input.fonte_url));
  if (input.nota_operacional !== undefined) assign("operational_note", nullable(input.nota_operacional));
  if (input.status_qa !== undefined) assign("qa_status", input.status_qa.trim().toUpperCase() || "NAO_AVALIADO");
  assign("updated_at", nowMs());

  await env.DB.prepare(`UPDATE assets SET ${columns.join(",")} WHERE id=?`).bind(...values, assetId).run();
  await writeAssetRecoveryRecord(env, assetId, "ASSET_METADATA_UPDATED").catch(() => undefined);
  return { asset: await getAsset(request, assetId, env) };
}

export async function registerAssetUsage(request: Request, input: UsageInput, env: Env) {
  const asset = await env.DB.prepare("SELECT id FROM assets WHERE id=?").bind(input.asset_id).first();
  if (!asset) return { error: "NOT_FOUND", status: 404 as const };
  const usageId = id("USE");
  const timestamp = nowMs();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO asset_usage
      (id,asset_id,project,block,preset,slot,role,script_reference,note,status,used_at)
      VALUES (?,?,?,?,?,?,?,?,?,'ATIVO',?)`)
      .bind(usageId, input.asset_id, input.projeto, nullable(input.bloco), nullable(input.preset), nullable(input.slot), nullable(input.funcao), nullable(input.referencia_roteiro), nullable(input.observacao), timestamp),
    env.DB.prepare("UPDATE assets SET use_count=use_count+1,last_used_at=?,updated_at=? WHERE id=?")
      .bind(timestamp, timestamp, input.asset_id),
  ]);
  return { usage: { id: usageId, asset_id: input.asset_id, project: input.projeto, used_at: timestamp }, asset: await getAsset(request, input.asset_id, env) };
}

export async function rejectAsset(request: Request, assetId: string, reason: string, env: Env) {
  const current = await env.DB.prepare("SELECT status,operational_note FROM assets WHERE id=?").bind(assetId).first<{status:string; operational_note:string|null}>();
  if (!current) return { error: "NOT_FOUND", status: 404 as const };
  const note = [current.operational_note, `Rejeitado: ${reason.trim() || "sem motivo"}`].filter(Boolean).join("\n");
  await env.DB.prepare("UPDATE assets SET previous_status=status,status='Rejeitado',operational_note=?,updated_at=? WHERE id=?")
    .bind(note, nowMs(), assetId).run();
  await writeAssetRecoveryRecord(env, assetId, "ASSET_REJECTED").catch(() => undefined);
  return { asset: await getAsset(request, assetId, env) };
}

export async function restoreAsset(request: Request, assetId: string, env: Env) {
  const current = await env.DB.prepare("SELECT previous_status,status FROM assets WHERE id=?").bind(assetId).first<{previous_status:string|null;status:string}>();
  if (!current) return { error: "NOT_FOUND", status: 404 as const };
  const restored = current.previous_status || "Pendente";
  await env.DB.prepare("UPDATE assets SET status=?,previous_status=NULL,updated_at=? WHERE id=?")
    .bind(restored, nowMs(), assetId).run();
  await writeAssetRecoveryRecord(env, assetId, "ASSET_RESTORED").catch(() => undefined);
  return { asset: await getAsset(request, assetId, env) };
}

export async function approvePendingAssets(request: Request, assetIds: string[], note: string | undefined, env: Env) {
  const ids = [...new Set(assetIds.map(String).filter(Boolean))].slice(0, 200);
  if (!ids.length) return { approved: 0, assets: [] };
  const timestamp = nowMs();
  const statements = ids.map(assetId => env.DB.prepare(
    "UPDATE assets SET previous_status=status,status='Aprovado',qa_status='APROVADO',operational_note=CASE WHEN ?='' THEN operational_note WHEN operational_note IS NULL OR operational_note='' THEN ? ELSE operational_note || char(10) || ? END,updated_at=? WHERE id=? AND status LIKE 'Pendente%'",
  ).bind(note?.trim() || "", note?.trim() || "", note?.trim() || "", timestamp, assetId));
  const results = await env.DB.batch(statements);
  const changed = results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  const assets: NonNullable<Awaited<ReturnType<typeof getAsset>>>[] = [];
  for (const assetId of ids) {
    const asset = await getAsset(request, assetId, env);
    if (asset?.rawStatus === "Aprovado") assets.push(asset);
  }
  for (const asset of assets) await writeAssetRecoveryRecord(env, String(asset.id), "ASSET_APPROVED").catch(() => undefined);
  if (changed) await refreshRecoveryAfterWrite(env, "ASSETS_APPROVED", String(changed));
  return { approved: changed, assets };
}

export async function findDuplicateR2Keys(env: Env, limit = 100) {
  const result = await env.DB.prepare(`SELECT r2_key,COUNT(*) AS count,GROUP_CONCAT(id) AS asset_ids
    FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>'' GROUP BY r2_key HAVING COUNT(*)>1 ORDER BY count DESC,r2_key LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 500))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function deleteAssetPermanently(env: Env, assetId: string, confirm: boolean) {
  if (!confirm) return { error: "CONFIRM_REQUIRED", status: 400 } as const;
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first<Record<string, unknown>>();
  if (!asset) return { error: "NOT_FOUND", status: 404 } as const;
  const r2Key = String(asset.r2_key || "");
  const shared = r2Key ? await env.DB.prepare("SELECT COUNT(*) AS n FROM assets WHERE r2_key=? AND id<>?").bind(r2Key, assetId).first<{ n:number }>() : null;
  const fileExisted = Boolean(r2Key && await env.MEDIA.head(r2Key).catch(() => null));
  const ts=nowMs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM asset_consultations WHERE asset_id=?").bind(assetId),
    env.DB.prepare("DELETE FROM asset_usage WHERE asset_id=?").bind(assetId),
    env.DB.prepare("DELETE FROM batch_assets WHERE asset_id=?").bind(assetId),
    env.DB.prepare("UPDATE collection_candidates SET asset_id=NULL WHERE asset_id=?").bind(assetId),
    env.DB.prepare("UPDATE materialization_files SET final_asset_id=NULL WHERE final_asset_id=?").bind(assetId),
    env.DB.prepare("UPDATE materialization_items SET frozen_asset_id=NULL,status=CASE WHEN status='FROZEN' THEN 'RELINK_REQUIRED' ELSE status END,updated_at=? WHERE frozen_asset_id=?").bind(ts,assetId),
    env.DB.prepare("UPDATE v2_ingest_candidates SET asset_id=NULL,updated_at=? WHERE asset_id=?").bind(ts,assetId),
    env.DB.prepare("UPDATE automatic_project_items SET linked_asset_id=NULL,status=CASE WHEN linked_asset_id IS NOT NULL THEN 'RELINK_REQUIRED' ELSE status END,updated_at=? WHERE linked_asset_id=?").bind(ts,assetId),
    env.DB.prepare("DELETE FROM assets WHERE id=?").bind(assetId),
  ]);
  let fileRemoved=false;
  if (r2Key && Number(shared?.n||0)===0 && fileExisted) { await env.MEDIA.delete(r2Key); fileRemoved=true; }
  await writeAssetDeletionTombstone(env,asset,"PERMANENT_DELETE").catch(() => undefined);
  await deleteAssetRecoveryRecord(env,assetId);
  await refreshRecoveryAfterWrite(env,"ASSET_PERMANENTLY_DELETED",assetId);
  return { deleted: assetId, r2Key, fileExisted, fileRemoved, sharedR2Key: Number(shared?.n||0)>0, status: 200 } as const;
}

export async function deleteAssetsPermanently(env: Env, assetIds: string[], confirm: boolean) {
  if (!confirm) return { error: "CONFIRM_REQUIRED", status: 400 } as const;
  const ids=[...new Set((assetIds||[]).map(String).map(v=>v.trim()).filter(Boolean))].slice(0,500);
  const results=[] as Array<Record<string,unknown>>;
  for(const assetId of ids){ const deleted=await deleteAssetPermanently(env,assetId,true); results.push({assetId,...deleted}); }
  return { requested:ids.length,deleted:results.filter(r=>r.deleted).length,filesRemoved:results.filter(r=>r.fileRemoved===true).length,metadataOnly:results.filter(r=>r.deleted && r.fileExisted===false).length,results };
}

export async function deletePendingAssetsPermanently(env: Env, assetIds: string[], confirm: boolean) {
  if (!confirm) return { error: "CONFIRM_REQUIRED", status: 400 } as const;
  const ids=[...new Set((assetIds||[]).map(String).map(v=>v.trim()).filter(Boolean))].slice(0,200);
  const results=[] as Array<Record<string,unknown>>;
  for(const assetId of ids){const row=await env.DB.prepare("SELECT status FROM assets WHERE id=?").bind(assetId).first<{status:string}>();if(!row){results.push({assetId,error:"NOT_FOUND"});continue;}if(!String(row.status).toLowerCase().startsWith("pendente")){results.push({assetId,error:"NOT_PENDING",status:row.status});continue;}const deleted=await deleteAssetPermanently(env,assetId,true);results.push({assetId,...deleted});}
  return { requested:ids.length,deleted:results.filter(r=>r.deleted).length,results };
}
