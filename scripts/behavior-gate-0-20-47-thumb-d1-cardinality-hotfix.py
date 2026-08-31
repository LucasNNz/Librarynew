from pathlib import Path
import json, re, sqlite3, sys, io, zipfile

root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf-8')
package=json.loads(read('package.json'))
cfpackage=json.loads(read('cloudflare/package.json'))
page=read('app/page.tsx')
index=read('cloudflare/src/index.ts')
mcp=read('cloudflare/src/mcp.ts')
direct=read('cloudflare/src/core/direct-upload.ts')
production=read('cloudflare/src/core/production.ts')
model=read('cloudflare/src/core/production-model.ts')
projects=read('cloudflare/src/core/projects.ts')
workflow=read('cloudflare/src/core/project-workflow.ts')
schema_contract=read('cloudflare/src/core/schema-contract.ts')
bundle=read('lib/generated-core-bundle.ts')

# Exact SQL smoke for the new file-object thumb materialization INSERT.
thumb_candidate_sql="""INSERT OR IGNORE INTO v2_ingest_candidates (id,operation_id,source_url,project_id,item_id,universe,subject,tags_json,status,r2_key,mime_type,size_bytes,failure_reason,attempts,created_at,updated_at,discovered_at,queued_at,download_started_at,materialized_at,queue_wait_ms,download_ms,r2_write_ms,d1_finalize_ms,total_materialization_ms) VALUES (?,?,?,?,NULL,'','THUMB',?,'MATERIALIZED',?,?,?,NULL,0,?,?,?,?,?,?,0,0,0,0,0)"""
con=sqlite3.connect(':memory:')
con.execute('''CREATE TABLE v2_ingest_candidates(
 id TEXT PRIMARY KEY,operation_id TEXT,source_url TEXT,project_id TEXT,item_id TEXT,universe TEXT,subject TEXT,tags_json TEXT,status TEXT,r2_key TEXT,mime_type TEXT,size_bytes INTEGER,failure_reason TEXT,attempts INTEGER,created_at INTEGER,updated_at INTEGER,discovered_at INTEGER,queued_at INTEGER,download_started_at INTEGER,materialized_at INTEGER,queue_wait_ms INTEGER,download_ms INTEGER,r2_write_ms INTEGER,d1_finalize_ms INTEGER,total_materialization_ms INTEGER
)''')
params=('CAND-T','OP-T','mcp-file://CAND-T','PROJ-T','["thumb","mcp-file"]','incoming/mcp-thumb/PROJ-T/CAND-T/thumb.png','image/png',1234,1,1,1,1,1,1)
sql_candidate_executes=True
try:
    con.execute(thumb_candidate_sql,params)
    row=con.execute("SELECT subject,status,mime_type,size_bytes FROM v2_ingest_candidates WHERE id='CAND-T'").fetchone()
    sql_candidate_executes = row==('THUMB','MATERIALIZED','image/png',1234)
except Exception:
    sql_candidate_executes=False

# Exact SQL smoke for the shared candidate -> THUMB project-media INSERT.
thumb_media_sql="""INSERT OR IGNORE INTO v2_project_media (id,project_id,kind,status,name,r2_key,mime_type,size_bytes,source_url,agent_origin,selected,metadata_json,slot_index,orientation,created_at,updated_at) VALUES (?,?,'THUMB','THUMB_CANDIDATE',?,?,?,?,?,?,0,?,?,?,?,?)"""
con_media=sqlite3.connect(':memory:')
con_media.execute("CREATE TABLE v2_project_media(id TEXT PRIMARY KEY,project_id TEXT,kind TEXT,status TEXT,name TEXT,r2_key TEXT,mime_type TEXT,size_bytes INTEGER,source_url TEXT,agent_origin TEXT,selected INTEGER,metadata_json TEXT,slot_index INTEGER,orientation TEXT,created_at INTEGER,updated_at INTEGER)")
media_params=('PMEDIA-T','PROJ-T','thumb.png','incoming/thumb.png','image/png',1234,'mcp-file://CAND-T','MCP_THUMB_FILE','{\"candidateId\":\"CAND-T\"}',1,None,1,1)
sql_media_executes=True
try:
    con_media.execute(thumb_media_sql,media_params)
    media_row=con_media.execute("SELECT kind,status,selected,slot_index,mime_type,size_bytes FROM v2_project_media WHERE id='PMEDIA-T'").fetchone()
    sql_media_executes=media_row==('THUMB','THUMB_CANDIDATE',0,1,'image/png',1234)
except Exception:
    sql_media_executes=False

# Small manifest contract smoke: flat stored ZIP with image magic should satisfy the same public shape.
def manifest_report(blob:bytes, expected:list[str]):
    z=zipfile.ZipFile(io.BytesIO(blob),'r')
    names=z.namelist()
    missing=[x for x in expected if x not in names]
    unexpected=[x for x in names if x not in expected]
    duplicates=sorted(set(x for i,x in enumerate(names) if x in names[:i]))
    flat=all(x and '/' not in x and '\\' not in x and not x.endswith('/') for x in names)
    invalid=[]
    for name in names:
        data=z.read(name)[:16]
        lower=name.lower()
        ok=(lower.endswith(('.jpg','.jpeg')) and data.startswith(b'\xff\xd8\xff')) or (lower.endswith('.png') and data.startswith(b'\x89PNG\r\n\x1a\n')) or (lower.endswith('.webp') and data[:4]==b'RIFF' and data[8:12]==b'WEBP')
        if not ok: invalid.append(name)
    return dict(expected=len(expected),found=len(names),missing=len(missing),unexpected=len(unexpected),duplicates=len(duplicates),invalid=len(invalid),flat=flat,ok=len(expected)==len(names) and not missing and not unexpected and not duplicates and not invalid and flat)

buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_STORED) as z:
    z.writestr('001-a.jpg',b'\xff\xd8\xff'+b'A'*32)
    z.writestr('002-b.png',b'\x89PNG\r\n\x1a\n'+b'B'*32)
valid_manifest=manifest_report(buf.getvalue(),['001-a.jpg','002-b.png'])
buf_bad=io.BytesIO()
with zipfile.ZipFile(buf_bad,'w',compression=zipfile.ZIP_STORED) as z:
    z.writestr('sub/001-a.jpg',b'not-jpeg')
invalid_manifest=manifest_report(buf_bad.getvalue(),['001-a.jpg'])

thumb_start=direct.index('export async function attachProjectThumbFromFileObject')
thumb_src=direct[thumb_start:]
finalize_start=production.index('export async function finalizeQaAndQueueDelivery')
finalize_src=production[finalize_start:production.index('export async function listReadyPackages',finalize_start)]
process_start=production.index('export async function processPackageJob')
process_end=production.index('export async function finalizeQaAndQueueDelivery')
process_src=production[process_start:process_end]
reconcile_start=model.index('export async function reconcileLegacyProjectItemsFromProduction')
reconcile_src=model[reconcile_start:model.index('export async function productionCompletionGate',reconcile_start)]

checks={
  'version_0_20_47_everywhere': package.get('version')=='0.20.47' and cfpackage.get('version')=='0.20.47' and 'const EXPECTED_CORE_VERSION = "0.20.47"' in page and 'version: "0.20.47"' in index and 'version: "0.20.47"' in mcp,
  'schema_stays_2_26': 'const CONTRACT_VERSION = "2.26.0"' in schema_contract and not any((root/'cloudflare/migrations').glob('9027*.sql')),
  'source_bundle_is_unbuilt_0_20_47': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.47)' in bundle,

  'thumb_file_route_exists': 'registerTool("anexar_thumb_arquivo"' in mcp and 'attachProjectThumbFromFileObject' in mcp,
  'thumb_file_route_no_prepared_ticket': 'Não devolve ticket PREPARED' in mcp and 'ticket_required:false' in thumb_src,
  'thumb_accepts_inline_base64_and_resource_blob': '"blob"' in direct and 'decodeBase64Bytes' in thumb_src,
  'thumb_accepts_byte_array': 'new Uint8Array(nums)' in direct,
  'thumb_accepts_file_blob_arraybuffer': 'binaryObjectBytes' in direct and 'arrayBuffer' in direct,
  'thumb_accepts_runtime_rewritten_https_reference': 'remoteUrlFromFileObject' in thumb_src and 'fetch(remote' in thumb_src,
  'thumb_sniffs_real_image_bytes': 'sniffImageMime(input.bytes)' in direct and 'THUMB_IMAGE_REQUIRED' in direct and 'THUMB_MIME_MISMATCH' in direct,
  'thumb_size_guard': 'MAX_MCP_THUMB_BYTES' in direct and 'FILE_TOO_LARGE' in thumb_src,
  'thumb_stable_idempotency': 'stableId("CAND",`MCP_THUMB_FILE' in direct and 'existingMedia' in direct and 'idempotent:true' in direct,
  'thumb_materializes_candidate_before_media': "'MATERIALIZED'" in direct and 'createProjectMediaFromCandidate' in direct,
  'thumb_candidate_insert_sql_present_and_cardinality': thumb_candidate_sql in direct and thumb_candidate_sql.count('?')==14 and sql_candidate_executes,
  'thumb_project_media_insert_16_values_cardinality': thumb_media_sql in production and thumb_media_sql.count('?')==13 and len(media_params)==13 and sql_media_executes,
  'thumb_project_media_insert_shared_helper': 'export async function createProjectMediaFromCandidate' in production and thumb_media_sql in production,
  'thumb_max_three_project_slots': 'THUMB_SLOTS_FULL' in direct and '>=3' in direct,
  'catalog_import_points_to_new_thumb_route': 'Para THUMB local de projeto, use anexar_thumb_arquivo' in mcp,

  'finalize_mcp_uses_orchestrator': 'finalizeQaAndQueueDelivery' in mcp and 'server.registerTool("finalizar_qa_projeto"' in mcp,
  'already_frozen_legacy_project_can_close': 'if(!assigned.length)' in model and 'counts.complete?"GENERATE_PACKAGE"' in model,
  'post_qa_reconciles_legacy_items': 'reconcileLegacyProjectItemsFromProduction' in finalize_src,
  'post_qa_blocks_revisar_tags': '"REVISAR","REVISADO_PARA_QA"' in finalize_src,
  'post_qa_requires_zero_slot_gaps': 'Boolean(gate.complete)' in finalize_src and 'production_slots_relink_required' in finalize_src and 'production_slots_pending' in finalize_src,
  'post_qa_sets_qa_concluido': "pipeline_status='QA_CONCLUIDO'" in finalize_src and 'activate:["QA_CONCLUIDO"]' in finalize_src,
  'post_qa_auto_queues_images_zip': 'queueFinalPackage' in finalize_src and 'type:"PROJECT_IMAGES_ZIP"' in finalize_src,
  'existing_ready_zip_is_reused_and_validated': 'READY_FOR_DOWNLOAD' in production and 'revision_hash=?' in production and 'validateProjectImagesZip' in finalize_src,

  'production_slot_is_legacy_source_of_truth': 'source_of_truth:"PRODUCTION_SLOT"' in reconcile_src,
  'legacy_items_map_frozen': 'const state=frozen?"FROZEN"' in reconcile_src,
  'legacy_items_map_relink_and_qa': '"RELINK_REQUIRED":assigned?"ASSIGNED_FOR_QA"' in reconcile_src or ('relink?"RELINK_REQUIRED":assigned?"ASSIGNED_FOR_QA"' in reconcile_src),
  'legacy_worker_items_cancelled_when_resolved': 'PRODUCTION_SLOT_TRUTH_RECONCILED' in reconcile_src and "status IN ('READY','LEASED')" in reconcile_src,
  'automatic_reconcile_invokes_slot_truth_first': (lambda src: 'reconcileLegacyProjectItemsFromProduction(env,projectId)' in src and src.index('reconcileLegacyProjectItemsFromProduction(env,projectId)') < src.index('productionCompletionGate(env,projectId)'))(projects[projects.index('export async function reconcileAutomaticProject'):]),

  'zip_validator_route_exists': 'registerTool("validar_imagens_zip_projeto"' in mcp and 'validateProjectImagesZip' in mcp,
  'zip_validator_contract_fields': all(x in production for x in ['expected:indexed.length' if False else 'expected:expected.length','found:indexed.length','missing:missing.length','unexpected:unexpected.length','duplicates:duplicates.length','invalid:invalidDetails.length','flat,ok:']),
  'zip_validator_reads_central_directory': 'ZIP_INDEX_EOCD_NOT_FOUND' in production and 'ZIP_INDEX_INVALID_CENTRAL_DIRECTORY' in production,
  'zip_validator_checks_image_magic': 'sniffImageBytes' in production and 'IMAGE_FORMAT_MISMATCH' in production,
  'zip_validator_requires_flat_archive': 'flat=indexed.every' in production,
  'zip_manifest_gate_runs_before_ready_status': process_src.index('manifestValidation=await validateImagesZipObject') < process_src.index("status='READY_FOR_DOWNLOAD'"),
  'zip_manifest_failure_blocks_ready': 'FORMA_ZIP_MANIFEST_INVALID' in process_src,
  'valid_manifest_smoke': valid_manifest=={'expected':2,'found':2,'missing':0,'unexpected':0,'duplicates':0,'invalid':0,'flat':True,'ok':True},
  'invalid_manifest_smoke_rejected': invalid_manifest['ok'] is False and (invalid_manifest['missing']>0 or invalid_manifest['unexpected']>0 or invalid_manifest['invalid']>0 or not invalid_manifest['flat']),
  'project_ready_only_after_images_gate': "pipeline_status='READY_FOR_DOWNLOAD'" in process_src and "next_action='DOWNLOAD_IMAGES_ZIP'" in process_src,
  'workflow_knows_qa_concluido': '"QA_CONCLUIDO"' in workflow,
}
report={
  'version':'0.20.47',
  'schema':'2.26.0',
  'feature':'THUMB D1 cardinality hotfix + Post-QA closure + direct MCP thumb file + internal imagens.zip manifest gate',
  'checks':checks,
  'thumb_candidate_sql_placeholders':thumb_candidate_sql.count('?'),
  'thumb_project_media_sql_placeholders':thumb_media_sql.count('?'),
  'thumb_project_media_sql_bindings':len(media_params),
  'valid_manifest_smoke':valid_manifest,
  'invalid_manifest_smoke':invalid_manifest,
  'pass':all(checks.values())
}
out=root/'BEHAVIOR_GATE_0_20_47_THUMB_D1_CARDINALITY_HOTFIX.json'
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(0 if report['pass'] else 1)
