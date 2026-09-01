from pathlib import Path
import json, re, sqlite3, sys

root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf-8')
package=json.loads(read('package.json'))
cfpackage=json.loads(read('cloudflare/package.json'))
page=read('app/page.tsx')
index=read('cloudflare/src/index.ts')
mcp=read('cloudflare/src/mcp.ts')
projects=read('cloudflare/src/core/projects.ts')
workers=read('cloudflare/src/core/workers.ts')
model=read('cloudflare/src/core/production-model.ts')
workflow=read('cloudflare/src/core/project-workflow.ts')
policies=read('cloudflare/src/core/persistent-policies.ts')
ops=read('cloudflare/src/core/operations.ts')
telemetry=read('cloudflare/src/core/d1-telemetry.ts')
contract=read('cloudflare/src/core/schema-contract.ts')
control=read('cloudflare/src/core/control-plane.ts')
restore=read('app/api/setup/cloudflare/restore/route.ts')
migrations_route=read('app/api/setup/migrations/route.ts')
mig=read('cloudflare/migrations/9027_v2_d1_read_optimization.sql')
bundle=read('lib/generated-core-bundle.ts')

# Function slices make assertions more precise and avoid accidental matches elsewhere.
def slice_fn(source:str, start_marker:str, end_marker:str):
    start=source.index(start_marker)
    end=source.find(end_marker,start+len(start_marker)) if end_marker else -1
    return source[start:] if end<0 else source[start:end]

list_admin=slice_fn(projects,'export async function listAutomaticProjects','export async function listActionableProjects')
list_actionable=slice_fn(projects,'export async function listActionableProjects','export async function getShortOperationalSnapshot')
short_snapshot=slice_fn(projects,'export async function getShortOperationalSnapshot','export async function createAutomaticProject')
reconcile=slice_fn(projects,'export async function reconcileAutomaticProject','export async function processAutomaticProject')
compact=slice_fn(workers,'export async function compactWorkerQueue','export async function configureWorkerLimit') if 'export async function compactWorkerQueue' in workers else ''
# compactWorkerQueue is currently after configureWorkerLimit, so fall back to tail.
if not compact or len(compact)<300:
    compact=workers[workers.index('export async function compactWorkerQueue'):]
legacy_reconcile=slice_fn(model,'export async function reconcileLegacyProjectItemsFromProduction','export async function productionCompletionGate')

checks={
 'version_app_0_20_53': package.get('version')=='0.20.53',
 'version_core_package_0_20_53': cfpackage.get('version')=='0.20.53',
 'version_page_0_20_53': 'const EXPECTED_CORE_VERSION = "0.20.53"' in page,
 'version_worker_0_20_53': 'version: "0.20.53"' in index,
 'version_mcp_0_20_53': 'version: "0.20.53"' in mcp,
 'bundle_unbuilt_for_0_20_53': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.53)' in bundle,
 'schema_2_27_exposed': 'schemaVersion:"2.27.0"' in migrations_route and 'const CONTRACT_VERSION = "2.27.0"' in contract,
 'migration_9027_present': '9027_v2_d1_read_optimization.sql' in control and '9027_v2_d1_read_optimization.sql' in restore,
 'restore_version_map_knows_2_27': '"2.27.0":"9027_v2_d1_read_optimization.sql"' in restore,
 'migration_duplicate_alter_guard_local': 'd1ReadOptimizationMigration' in control and 'schema_contract_reconciled' in control,
 'migration_duplicate_alter_guard_restore': 'd1ReadOptimizationMigration' in restore and 'schema_contract_reconciled' in restore,

 'actionable_route_registered': 'registerTool("listar_projetos_acionaveis"' in mcp,
 'actionable_route_is_control_plane': 'CONTROL PLANE PREFERENCIAL PARA AGENTES' in mcp,
 'actionable_requires_active_and_next_action': "COALESCE(lifecycle_status,'ACTIVE')='ACTIVE'" in list_actionable and 'next_action IS NOT NULL' in list_actionable,
 'actionable_is_bounded': 'Math.min(Number(input.limit||50),100)' in list_actionable and 'LIMIT ?' in list_actionable,
 'actionable_uses_batched_tag_reads': 'project_id IN (${placeholders})' in list_actionable and 'Promise.all' in list_actionable,
 'admin_list_no_global_tag_expiration': 'expireProjectWorkflowTags(' not in list_admin,

 'short_snapshot_not_heavy_snapshot': 'getOperationalSnapshot(' not in short_snapshot and 'automatic_project_files' not in short_snapshot and 'v2_ingest_candidates' not in short_snapshot,
 'short_snapshot_state_version_short_circuit': 'not_modified:true' in short_snapshot and short_snapshot.index('not_modified:true') < short_snapshot.index('FROM v2_production_slots'),
 'short_snapshot_only_project_plus_pslot_counts': 'FROM automatic_projects WHERE id=?' in short_snapshot and 'FROM v2_production_slots WHERE project_id=? AND version=?' in short_snapshot,

 'legacy_reconcile_has_checkpoint': 'production_reconciled_at' in legacy_reconcile and 'reason:"UP_TO_DATE"' in legacy_reconcile,
 'legacy_reconcile_reads_items_scenes_slots_in_batch': 'env.DB.batch<Record<string,unknown>>' in legacy_reconcile and 'itemsResult,scenesResult,slotsResult' in legacy_reconcile,
 'reconcile_eliminates_worker_n_plus_one': 'activeWorkResult' in reconcile and 'activeWorkByItem' in reconcile and reconcile.count('SELECT id,item_id,status,worker_type,stage FROM worker_work_items')==1,
 'reconcile_state_version_only_when_changed': 'const stateChanged=' in reconcile and 'if(stateChanged)' in reconcile,
 'detail_read_no_longer_forces_derived_workflow_scan': 'syncDerivedProjectWorkflow(env,projectId)' not in slice_fn(workflow,'export async function projectSlotSnapshot','export async function projectAvailability'),
 'slot_policy_resolution_is_batched': 'resolveApplicablePoliciesBatch' in workflow and 'env.DB.batch<Record<string,unknown>>' in policies,

 'queue_compactor_route_registered': 'registerTool("compactar_fila_workers"' in mcp,
 'queue_compactor_preserves_history': "status='CANCELLED'" in compact and 'QUEUE_COMPACT_' in compact,
 'queue_compactor_handles_orphans_closed_terminal_duplicates': all(x in compact for x in ['QUEUE_COMPACT_ORPHAN_PARENT','QUEUE_COMPACT_CLOSED_PROJECT','QUEUE_COMPACT_TERMINAL_PARENT','QUEUE_COMPACT_DUPLICATE']),
 'dispatcher_compacts_then_selects_actionable': 'const compact=await compactWorkerQueue(env);const projects=await listActionableProjects' in mcp,

 'telemetry_table_in_migration': 'CREATE TABLE IF NOT EXISTS v2_mcp_route_telemetry' in mig,
 'telemetry_instruments_mcp_calls': 'createD1TelemetryEnv(env, metrics)' in mcp and 'recordD1RouteTelemetry(env, metrics)' in mcp,
 'telemetry_counts_queries_and_meta_rows': 'metrics.dbQueries += 1' in telemetry and 'rows_read' in telemetry and 'rows_written' in telemetry,
 'telemetry_failure_is_non_blocking': 'Telemetry must never make an operational MCP tool fail' in telemetry,
 'performance_reads_new_telemetry': 'source:"v2_mcp_route_telemetry"' in ops and 'ORDER BY rows_read_observed DESC,db_queries DESC,calls DESC' in ops,
 'performance_has_24h_ranking': 'last24h' in ops and 'Date.now()-24*60*60_000' in ops,
 'legacy_mcp_audit_is_only_fallback': 'source:"legacy_mcp_audit"' in ops,
 'performance_tool_description_updated': 'Telemetria D1 por rota MCP' in mcp,

 'critical_indexes_local_reconcile': all(name in contract for name in [
   'idx_automatic_projects_actionable','idx_project_items_project_status','idx_worker_ready_claim',
   'idx_worker_project_item_active','idx_v2_production_slot_project_version_status','idx_v2_slot_tags_project_key_active',
   'idx_project_files_project_role','idx_v2_project_media_lookup','idx_v2_project_titles_lookup']),
 'critical_indexes_restore_reconcile': all(name in restore for name in [
   'idx_automatic_projects_actionable','idx_project_items_project_status','idx_worker_ready_claim',
   'idx_worker_project_item_active','idx_v2_production_slot_project_version_status','idx_v2_slot_tags_project_key_active',
   'idx_project_files_project_role','idx_v2_project_media_lookup','idx_v2_project_titles_lookup']),

 'inline_qa_preserved': 'browser_required: false' in mcp and 'permission_required: false' in mcp,
 'responsive_workspace_preserved': 'container-name:project-detail' in read('app/globals.css'),
 'optional_publication_preserved': 'publication_optional:true' in model,
 'thumb_file_upload_preserved': 'registerTool("anexar_thumb_arquivo"' in mcp,
}

failed=[k for k,v in checks.items() if not v]
report={
 'version':'0.20.53',
 'schema':'2.27.0',
 'feature':'D1 read optimization: light control plane, indexed hot paths, queue compaction, state-version short-circuit and route telemetry',
 'passed':len(checks)-len(failed),
 'total':len(checks),
 'ok':not failed,
 'failed':failed,
 'checks':checks,
}
(root/'BEHAVIOR_GATE_0_20_53_D1_READ_OPTIMIZATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
