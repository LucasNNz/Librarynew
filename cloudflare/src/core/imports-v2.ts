import type { Env } from "../types";
import { catalogAsset, registerAssetUsage } from "./asset-ops";
import { id, nowMs } from "./ids";
import { limitedStream, safeRemoteUrl } from "./net";
import { prepareDirectUpload } from "./direct-upload";
import { refreshRecoveryAfterWrite, writeAssetRecoveryRecord, writeImportRecoveryRecord } from "./recovery-manifest";

function clean(value: unknown) { return String(value ?? "").trim(); }
const u16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
const u32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
function normalizePath(value: string) { return value.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(part => part && part !== "." && part !== "..").join("/"); }
function basename(value: string) { return normalizePath(value).split("/").pop() || "arquivo"; }
function normalizeLookup(value: string) { return normalizePath(value).normalize("NFC").toLocaleLowerCase("pt-BR"); }
function cleanName(value: string) { return value.normalize("NFC").replace(/[^a-zA-Z0-9._-]/g, "-"); }
function isYes(value?: string) { return /^(sim|s|yes|true|1)$/i.test(clean(value)); }
const MIME: Record<string,string> = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", avif:"image/avif", svg:"image/svg+xml", mp4:"video/mp4", webm:"video/webm", mov:"video/quicktime", m4v:"video/x-m4v" };
function defaultKind(ext: string) { return ext === "gif" ? "GIF" : MIME[ext]?.startsWith("video/") ? "Vídeo" : "Imagem"; }

type ZipEntry = { path:string; method:number; flags:number; compressedSize:number; uncompressedSize:number; localOffset:number };
type Manifest = { headers:Record<string,string>; sections:Map<string,Record<string,string>> };
type MediaMetadata = {
  section: Record<string,string>;
  name: string;
  universe: string;
  kind: string;
  subject: string | null;
  tags: string[];
  projectOrigin: string | null;
  scriptReference: string | null;
  visualReference: string | null;
  sourceUrl: string | null;
  note: string | null;
  qa: string;
  status: "Aprovado" | "Pendente";
  initialUse: boolean;
  classificationStatus: string;
  confidence: number | null;
  expectedSha256: string | null;
  aliases: string[];
};

function parseZip(bytes: Uint8Array) {
  let eocd = -1;
  for (let cursor = bytes.length - 22; cursor >= Math.max(0, bytes.length - 65557); cursor--) {
    if (u32(bytes, cursor) === 0x06054b50) { eocd = cursor; break; }
  }
  if (eocd < 0) throw new Error("ZIP_INVALID_EOCD");
  const total = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (total === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new Error("ZIP64_UNSUPPORTED");
  if (centralOffset + centralSize > bytes.length) throw new Error("ZIP_INVALID_CENTRAL_DIRECTORY");
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < total; index++) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new Error("ZIP_INVALID_ENTRY");
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("ZIP_TRUNCATED");
    const rawName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const path = normalizePath(rawName);
    if (path && !rawName.endsWith("/")) {
      totalUncompressed += uncompressedSize;
      if (uncompressedSize > 64 * 1024 * 1024) throw new Error(`ZIP_ENTRY_TOO_LARGE:${path}`);
      if (totalUncompressed > 256 * 1024 * 1024) throw new Error("ZIP_UNCOMPRESSED_LIMIT");
      entries.push({ path, method, flags, compressedSize, uncompressedSize, localOffset });
    }
    cursor = end;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const stream = new Blob([owned.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extract(zip: Uint8Array, entry: ZipEntry) {
  if (entry.flags & 1) throw new Error("ZIP_ENCRYPTED_UNSUPPORTED");
  if (u32(zip, entry.localOffset) !== 0x04034b50) throw new Error("ZIP_BAD_LOCAL_HEADER");
  const nameLength = u16(zip, entry.localOffset + 26);
  const extraLength = u16(zip, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > zip.length) throw new Error("ZIP_TRUNCATED_DATA");
  const part = zip.subarray(start, end);
  const out = entry.method === 0 ? new Uint8Array(part) : entry.method === 8 ? await inflateRaw(new Uint8Array(part)) : null;
  if (!out) throw new Error(`ZIP_METHOD_UNSUPPORTED:${entry.method}`);
  if (out.byteLength !== entry.uncompressedSize) throw new Error("ZIP_SIZE_MISMATCH");
  return out;
}

function parseManifest(raw: string): Manifest {
  const headers: Record<string,string> = {};
  const sections = new Map<string,Record<string,string>>();
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  let current = headers;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      current = {};
      sections.set(normalizeLookup(section[1]), current);
      continue;
    }
    const field = line.match(/^([A-ZÀ-Ú0-9_]+)\s*:\s*(.*)$/i);
    if (!field) continue;
    let value = field[2].trim();
    if (!value) {
      for (let next = index + 1; next < lines.length; next++) {
        const candidate = lines[next].trim();
        if (!candidate) continue;
        if (/^\[.+]$/.test(candidate) || /^[A-ZÀ-Ú0-9_]+\s*:/i.test(candidate)) break;
        value = candidate;
        index = next;
        break;
      }
    }
    current[field[1].toLocaleUpperCase("pt-BR")] = value;
  }
  return { headers, sections };
}

function tagsOf(value?: string) { return [...new Set(clean(value).split(/[,;|]/).map(item => item.trim()).filter(Boolean))]; }
function parseConfidence(value?: string) { const parsed = Number(clean(value)); return Number.isFinite(parsed) ? parsed : null; }
function normalizedSha(value?: string) { const sha = clean(value).toLowerCase(); return /^[a-f0-9]{64}$/.test(sha) ? sha : null; }

function metadata(path: string, manifest: Manifest | null): MediaMetadata {
  const file = basename(path);
  const ext = (file.split(".").pop() || "").toLowerCase();
  const section = manifest?.sections.get(normalizeLookup(path)) || manifest?.sections.get(normalizeLookup(file)) || {};
  const headers = manifest?.headers || {};
  const classificationStatus = clean(section.CLASSIFICATION_STATUS).toUpperCase();
  const confidence = parseConfidence(section.CLASSIFICATION_CONFIDENCE);
  const requestedQa = clean(section.STATUS_QA || headers.STATUS_PADRAO).toUpperCase();
  let qa = requestedQa || "NAO_AVALIADO";
  // Pacotes classificados visualmente podem entrar já organizados sem perder a revisão humana:
  // CONFIRMADO/GENERICO -> Catálogo; CONFIRMADO_MEDIO/REVISAR_UNIVERSO -> Pendentes.
  if (!requestedQa || ["NAO_AVALIADO", "PENDENTE"].includes(requestedQa)) {
    if (["CONFIRMADO", "GENERICO"].includes(classificationStatus)) qa = "APROVADO";
    else if (["CONFIRMADO_MEDIO", "REVISAR_UNIVERSO"].includes(classificationStatus)) qa = "RESSALVA";
  }
  const status: "Aprovado" | "Pendente" = qa === "APROVADO" ? "Aprovado" : "Pendente";
  const stem = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const aliases = tagsOf(section.ALIASES_DUPLICADOS);
  const tags = tagsOf(section.TAGS);
  if (classificationStatus) tags.push(`classificacao-${classificationStatus.toLocaleLowerCase("pt-BR").replace(/_/g, "-")}`);
  if (confidence != null) tags.push(`confianca-${Math.round(confidence * 100)}`);
  if (aliases.length) tags.push("possui-alias-duplicado");
  return {
    section,
    name: section.NOME_SEMANTICO || stem || file,
    universe: section.UNIVERSO || headers.UNIVERSO_PADRAO || "Sem universo",
    kind: section.TIPO || section.TIPO_MIDIA || defaultKind(ext),
    subject: section.PERSONAGEM || section.OBJETO || section.LOCAL || section.SUJEITO || null,
    tags: [...new Set(tags)],
    projectOrigin: section.PROJETO_ORIGEM || headers.PROJETO_ORIGEM || null,
    scriptReference: section.REFERENCIA_ROTEIRO || null,
    visualReference: section.REFERENCIA_VISUAL || null,
    sourceUrl: section.URL_ORIGINAL || section.FONTE || null,
    note: section.OBSERVACAO || headers.OBSERVACAO_GERAL || null,
    qa,
    status,
    initialUse: isYes(section.REGISTRAR_USO_INICIAL || headers.REGISTRAR_USO_INICIAL),
    classificationStatus,
    confidence,
    expectedSha256: normalizedSha(section.SHA256),
    aliases,
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function assetIdFromSha(sha: string) { return `AST-${sha.slice(0, 20).toUpperCase()}`; }
function r2CustomMetadata(assetId: string, meta: MediaMetadata, originalName: string, sha256: string, importId: string) {
  const compact = (value: string | null | undefined, max = 300) => clean(value).slice(0, max);
  return {
    corvoAssetId: assetId,
    corvoName: compact(meta.name),
    corvoUniverse: compact(meta.universe),
    corvoKind: compact(meta.kind, 100),
    corvoSubject: compact(meta.subject, 200),
    corvoQa: compact(meta.qa, 60),
    corvoClass: compact(meta.classificationStatus, 80),
    corvoConfidence: meta.confidence == null ? "" : String(meta.confidence),
    corvoOriginal: compact(originalName, 300),
    corvoSha256: sha256,
    corvoImportId: importId,
  };
}

export async function prepareZipUpload(request: Request, env: Env, fileName = "importacao.zip") {
  return prepareDirectUpload(request, env, {
    uploadType:"IMPORT_ZIP",
    fileName:fileName.endsWith(".zip") ? fileName : `${fileName}.zip`,
    mimeType:"application/zip",
    maxBytes:48 * 1024 * 1024,
    ttlSeconds:1800,
  });
}

export async function importZipByUrl(env: Env, input: { url:string; fileName:string; manifestText?:string }) {
  const remote = safeRemoteUrl(input.url);
  if (!remote) return { error:"PUBLIC_HTTPS_URL_REQUIRED_OR_USE_DIRECT_UPLOAD", status:400 } as const;
  const response = await fetch(remote.toString(), { redirect:"follow", headers:{ "user-agent":"CorvoLibraryV2/1.0" } });
  if (!response.ok || !response.body) return { error:`HTTP_${response.status}`, status:400 } as const;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 48 * 1024 * 1024) return { error:"ZIP_TOO_LARGE_SPLIT_INTO_BATCHES", status:413 } as const;
  const importId = id("IMP");
  const key = `imports/${importId}/${cleanName(input.fileName || "importacao.zip")}`;
  const ts = nowMs();
  const maxZipBytes = 48 * 1024 * 1024;
  const zipBytes = new Uint8Array(await new Response(limitedStream(response.body, maxZipBytes)).arrayBuffer());
  if (zipBytes.byteLength > maxZipBytes) return { error:"ZIP_TOO_LARGE_SPLIT_INTO_BATCHES", status:413 } as const;
  await env.MEDIA.put(key, zipBytes, { httpMetadata:{ contentType:"application/zip" }, customMetadata:{ importId } });
  const head = await env.MEDIA.head(key);
  await env.DB.prepare("INSERT INTO imports (id,file_name,r2_key,size_bytes,status,created_at,manifest_text,warnings) VALUES (?,?,?,?, 'Recebido',?,?, '[]')")
    .bind(importId, input.fileName || "importacao.zip", key, Number(head?.size || zipBytes.byteLength || length), ts, input.manifestText || null).run();
  await writeImportRecoveryRecord(env, importId, "IMPORT_RECEIVED").catch(() => undefined);
  await refreshRecoveryAfterWrite(env, "IMPORT_RECEIVED", importId);
  return { importId, status:"Recebido", r2Key:key };
}

export async function queueZipImport(env: Env, importId: string) {
  const job = await env.DB.prepare("SELECT id,status FROM imports WHERE id=?").bind(importId).first<{id:string;status:string}>();
  if (!job) return { error:"IMPORT_NOT_FOUND", status:404 } as const;
  const current = clean(job.status);
  if (["Concluído", "Concluído com avisos"].includes(current)) return { accepted:true, importId, status:current, idempotent:true, httpStatus:200 } as const;
  if (["Na fila", "Processando"].includes(current)) return { accepted:true, importId, status:current, idempotent:true, httpStatus:202 } as const;
  await env.DB.prepare("UPDATE imports SET status='Na fila' WHERE id=?").bind(importId).run();
  try {
    await env.MATERIALIZE_QUEUE.send({ kind:"PROCESS_IMPORT_ZIP", importId });
    return { accepted:true, importId, status:"Na fila", httpStatus:202 } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE imports SET status='Recebido',warnings=? WHERE id=?").bind(JSON.stringify([`QUEUE_SEND_FAILED: ${message}`]), importId).run().catch(() => undefined);
    return { error:"IMPORT_QUEUE_FAILED", detail:message, status:500 } as const;
  }
}

export async function processZipImport(env: Env, importId: string) {
  const job = await env.DB.prepare("SELECT * FROM imports WHERE id=?").bind(importId).first<Record<string,unknown>>();
  if (!job) return { error:"IMPORT_NOT_FOUND", status:404 } as const;
  if (["Concluído", "Concluído com avisos"].includes(clean(job.status))) return { importacao_id:importId, status:job.status, idempotent:true };
  await env.DB.prepare("UPDATE imports SET status='Processando' WHERE id=?").bind(importId).run();
  const warnings: string[] = [];
  try {
    const archiveKey = clean(job.r2_key);
    const object = await env.MEDIA.get(archiveKey);
    if (!object) throw new Error("ZIP_OBJECT_MISSING");
    if (object.size > 48 * 1024 * 1024) throw new Error("ZIP_TOO_LARGE_SPLIT_INTO_BATCHES");
    const zip = new Uint8Array(await object.arrayBuffer());
    const entries = parseZip(zip);
    const manifestEntry = entries.find(entry => basename(entry.path).toUpperCase() === "IMPORTACAO.TXT");
    let manifestText = clean(job.manifest_text);
    if (!manifestText && manifestEntry) manifestText = new TextDecoder().decode(await extract(zip, manifestEntry));
    const manifest = manifestText ? parseManifest(manifestText) : null;
    if (!manifest) warnings.push("IMPORTACAO.txt não encontrado; mídia ficará pendente.");
    const media = entries.filter(entry => MIME[(entry.path.split(".").pop() || "").toLowerCase()]);
    let cataloged = 0;
    let updated = 0;
    let usages = 0;
    let deduplicated = 0;
    let approved = 0;
    let pending = 0;

    for (const entry of media) {
      try {
        const ext = (entry.path.split(".").pop() || "").toLowerCase();
        const meta = metadata(entry.path, manifest);
        const data = await extract(zip, entry);
        const actualSha = await sha256Hex(data);
        let effectiveQa = meta.qa;
        let effectiveStatus = meta.status;
        if (meta.expectedSha256 && meta.expectedSha256 !== actualSha) {
          warnings.push(`${entry.path}: SHA256_MANIFEST_MISMATCH`);
          effectiveQa = "RESSALVA";
          effectiveStatus = "Pendente";
          meta.tags.push("sha256-divergente");
        }
        const preferredId = assetIdFromSha(actualSha);
        const existing = await env.DB.prepare("SELECT id,r2_key FROM assets WHERE sha256=? OR id=? LIMIT 1").bind(actualSha, preferredId).first<{id:string;r2_key:string}>();
        const assetId = existing?.id || preferredId;
        const file = cleanName(basename(entry.path));
        const r2Key = existing?.r2_key || `assets/${assetId}/${file}`;
        const currentObject = await env.MEDIA.head(r2Key);
        if (!currentObject || !clean(currentObject.customMetadata?.corvoAssetId)) {
          await env.MEDIA.put(r2Key, data, {
            httpMetadata:{ contentType:MIME[ext] },
            customMetadata:r2CustomMetadata(assetId, { ...meta, qa:effectiveQa, status:effectiveStatus }, basename(entry.path), actualSha, importId),
          });
        }
        const note = [meta.note, `Importação ${importId}`, meta.aliases.length ? `Aliases SHA-256: ${meta.aliases.join(", ")}` : null].filter(Boolean).join("\n");
        if (!existing) {
          const created = await catalogAsset(new Request("https://corvo.local/import"), {
            asset_id:assetId,
            nome:meta.name,
            r2_key:r2Key,
            arquivo_original:basename(entry.path),
            mime_type:MIME[ext],
            universo:meta.universe,
            tipo:meta.kind,
            sujeito:meta.subject || undefined,
            tags:[...new Set(meta.tags)],
            projeto_origem:meta.projectOrigin || undefined,
            referencia_roteiro:meta.scriptReference || undefined,
            referencia_visual:meta.visualReference || undefined,
            fonte_url:meta.sourceUrl || undefined,
            nota_operacional:note || undefined,
            status_qa:effectiveQa,
            defer_recovery:true,
            compact_response:true,
          }, env);
          if (created && typeof created === "object" && "error" in created) throw new Error(String(created.error));
          await env.DB.prepare("UPDATE assets SET status=?,qa_status=?,sha256=?,updated_at=? WHERE id=?")
            .bind(effectiveStatus, effectiveQa, actualSha, nowMs(), assetId).run();
          cataloged++;
        } else {
          deduplicated++;
          await env.DB.prepare(`UPDATE assets SET name=?,universe=?,kind=?,subject=?,tags=?,project_origin=?,script_reference=?,visual_reference=?,source_url=?,operational_note=?,qa_status=?,status=?,original_name=?,mime_type=?,size_bytes=?,sha256=?,updated_at=? WHERE id=?`)
            .bind(meta.name, meta.universe, meta.kind, meta.subject, JSON.stringify([...new Set(meta.tags)]), meta.projectOrigin, meta.scriptReference, meta.visualReference, meta.sourceUrl, note || null, effectiveQa, effectiveStatus, basename(entry.path), MIME[ext], data.byteLength, actualSha, nowMs(), assetId).run();
          updated++;
        }
        if (effectiveStatus === "Aprovado") approved++; else pending++;
        await writeAssetRecoveryRecord(env, assetId, "ZIP_IMPORT_ASSET").catch(() => undefined);
        if (meta.initialUse && meta.projectOrigin) {
          const use = await registerAssetUsage(new Request("https://corvo.local/import"), {
            asset_id:assetId,
            projeto:meta.projectOrigin,
            bloco:meta.section.BLOCO,
            preset:meta.section.PRESET,
            slot:meta.section.SLOT,
            funcao:meta.section.USADO_PARA,
            referencia_roteiro:meta.section.REFERENCIA_ROTEIRO,
            observacao:meta.section.OBSERVACAO,
          }, env);
          if (!(use && typeof use === "object" && "error" in use)) usages++;
        }
      } catch (error) {
        warnings.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const status = warnings.length ? "Concluído com avisos" : "Concluído";
    // O arquivo ZIP é apenas transporte. Após materializar os assets, removê-lo evita duplicar centenas de MB no mesmo bucket.
    await env.MEDIA.delete(archiveKey).catch(() => undefined);
    await env.DB.prepare("UPDATE imports SET status=?,r2_key='',manifest_text=?,warnings=? WHERE id=?")
      .bind(status, manifestText || null, JSON.stringify([...new Set(warnings)]), importId).run();
    await writeImportRecoveryRecord(env, importId, "IMPORT_COMPLETED").catch(() => undefined);
    await refreshRecoveryAfterWrite(env, "IMPORT_COMPLETED", importId);
    return {
      importacao_id:importId,
      status,
      midias_no_zip:media.length,
      assets_catalogados:cataloged,
      assets_atualizados:updated,
      assets_deduplicados:deduplicated,
      aprovados:approved,
      pendentes:pending,
      usos_iniciais_registrados:usages,
      manifesto_lido:Boolean(manifestText),
      arquivo_transporte_removido:true,
      avisos:[...new Set(warnings)],
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    await env.DB.prepare("UPDATE imports SET status='Erro',warnings=? WHERE id=?").bind(JSON.stringify(warnings), importId).run();
    return { error:warnings[warnings.length - 1], status:500, importacao_id:importId } as const;
  }
}

export async function importMediaByPreparedUpload() {
  return { mode:"DIRECT_UPLOAD", instruction:"Use preparar_upload_midia / confirmar_upload_midia; o MCP não transporta binários." };
}

// Compatibilidade MCP: leitura somente, sem autoalterar o catálogo.
export async function syncR2Uncataloged(env: Env, input: { prefix?:string; limit?:number }) {
  const limit = Math.max(1, Math.min(input.limit || 1000, 1000));
  const listed = await env.MEDIA.list({ prefix:input.prefix || "assets/", limit });
  const pending: Array<{key:string;size:number}> = [];
  for (const object of listed.objects) {
    const ref = await env.DB.prepare("SELECT id FROM assets WHERE r2_key=? LIMIT 1").bind(object.key).first();
    if (!ref) pending.push({ key:object.key, size:object.size });
  }
  return { scanned:listed.objects.length, uncataloged:pending.length, pending, truncated:listed.truncated, readOnly:true };
}
