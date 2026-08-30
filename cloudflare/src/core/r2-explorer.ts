import type { Env } from "../types";

type ReferenceRow = { source_table: string; source_id: string; r2_key: string };
type ObjectRow = { key: string; size: number; uploaded: string; etag: string };

function normalizePrefix(value: string | null) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

async function knownReferences(env: Env) {
  const result = await env.DB.prepare(`
    SELECT 'assets' AS source_table,id AS source_id,r2_key FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
    UNION ALL SELECT 'automatic_project_files',id,r2_key FROM automatic_project_files WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
    UNION ALL SELECT 'automatic_projects',id,zip_r2_key FROM automatic_projects WHERE zip_r2_key IS NOT NULL AND TRIM(zip_r2_key)<>''
    UNION ALL SELECT 'export_jobs',id,r2_key FROM export_jobs WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
    UNION ALL SELECT 'imports',id,r2_key FROM imports WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
    UNION ALL SELECT 'materialization_files',id,r2_key FROM materialization_files WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
    UNION ALL SELECT 'v2_ingest_candidates',id,r2_key FROM v2_ingest_candidates WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>''
  `).all<ReferenceRow>();
  return result.results || [];
}

async function scanObjects(env: Env, prefix: string, maxObjects: number) {
  const objects: ObjectRow[] = [];
  let cursor: string | undefined;
  do {
    const remaining = maxObjects - objects.length;
    if (remaining <= 0) break;
    const page = await env.MEDIA.list({ limit: Math.min(1000, remaining), cursor, prefix: prefix || undefined });
    for (const object of page.objects) {
      objects.push({
        key: object.key,
        size: Number(object.size || 0),
        uploaded: object.uploaded.toISOString(),
        etag: object.httpEtag,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < maxObjects);
  return { objects, truncated: Boolean(cursor) };
}

export async function exploreR2(request: Request, env: Env) {
  const url = new URL(request.url);
  const prefix = normalizePrefix(url.searchParams.get("prefix"));
  const maxObjects = Math.max(100, Math.min(Number(url.searchParams.get("maxObjects") || 10000), 50000));
  const [inventory, references] = await Promise.all([scanObjects(env, prefix, maxObjects), knownReferences(env)]);

  const refsByKey = new Map<string, ReferenceRow[]>();
  for (const row of references) refsByKey.set(row.r2_key, [...(refsByKey.get(row.r2_key) || []), row]);

  const folderMap = new Map<string, { prefix: string; name: string; objects: number; bytes: number; referencedObjects: number; orphanObjects: number; newestUploaded: string | null }>();
  const directObjects: Array<ObjectRow & { referenced: boolean; references: ReferenceRow[] }> = [];
  let referencedObjects = 0;
  let orphanObjects = 0;
  let totalBytes = 0;

  for (const object of inventory.objects) {
    totalBytes += object.size;
    const referenced = refsByKey.has(object.key);
    if (referenced) referencedObjects += 1;
    else orphanObjects += 1;

    const relative = object.key.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash >= 0) {
      const name = relative.slice(0, slash);
      const childPrefix = `${prefix}${name}/`;
      const current = folderMap.get(childPrefix) || { prefix: childPrefix, name, objects: 0, bytes: 0, referencedObjects: 0, orphanObjects: 0, newestUploaded: null };
      current.objects += 1;
      current.bytes += object.size;
      if (referenced) current.referencedObjects += 1;
      else current.orphanObjects += 1;
      if (!current.newestUploaded || object.uploaded > current.newestUploaded) current.newestUploaded = object.uploaded;
      folderMap.set(childPrefix, current);
    } else if (relative) {
      directObjects.push({ ...object, referenced, references: (refsByKey.get(object.key) || []).slice(0, 20) });
    }
  }

  const folders = [...folderMap.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  directObjects.sort((a, b) => b.uploaded.localeCompare(a.uploaded));

  const segments = prefix.split("/").filter(Boolean);
  const breadcrumbs = [{ name: "R2", prefix: "" }];
  let acc = "";
  for (const segment of segments) {
    acc += `${segment}/`;
    breadcrumbs.push({ name: segment, prefix: acc });
  }

  return {
    prefix,
    breadcrumbs,
    scannedObjects: inventory.objects.length,
    totalBytes,
    referencedObjects,
    orphanObjects,
    folders,
    objects: directObjects.slice(0, 500),
    directObjects: directObjects.length,
    truncated: inventory.truncated,
    maxObjects,
    readOnly: true,
  };
}
