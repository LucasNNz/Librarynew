#!/usr/bin/env python3
from pathlib import Path
import json, sqlite3, sys

root=Path(__file__).resolve().parents[1]
mig=(root/'cloudflare/migrations/9027_v2_d1_read_optimization.sql').read_text(encoding='utf-8')
control=(root/'cloudflare/src/core/control-plane.ts').read_text(encoding='utf-8')
contract=(root/'cloudflare/src/core/schema-contract.ts').read_text(encoding='utf-8')
restore=(root/'app/api/setup/cloudflare/restore/route.ts').read_text(encoding='utf-8')

con=sqlite3.connect(':memory:')
con.executescript('''
CREATE TABLE automatic_projects(id TEXT PRIMARY KEY,name TEXT,status TEXT,pipeline_status TEXT,next_action TEXT,project_domain TEXT,queue_priority INTEGER,state_version INTEGER,total_items INTEGER,approved_count INTEGER,frozen_count INTEGER,collecting_count INTEGER,materializing_count INTEGER,waiting_qa_count INTEGER,relink_count INTEGER,technical_count INTEGER,pending_count INTEGER,failed_count INTEGER,active_version INTEGER,created_at INTEGER,updated_at INTEGER,workflow_updated_at INTEGER,lifecycle_status TEXT,mcp_locked INTEGER);
CREATE TABLE automatic_project_items(id TEXT PRIMARY KEY,project_id TEXT,version INTEGER,status TEXT,priority INTEGER,updated_at INTEGER,created_at INTEGER);
CREATE TABLE automatic_project_files(id TEXT PRIMARY KEY,project_id TEXT,role TEXT,version INTEGER,created_at INTEGER);
CREATE TABLE automatic_project_events(id TEXT PRIMARY KEY,project_id TEXT,created_at INTEGER);
CREATE TABLE worker_work_items(id TEXT PRIMARY KEY,project_id TEXT,item_id TEXT,status TEXT,worker_type TEXT,project_domain TEXT,stage TEXT,resume_priority INTEGER,priority INTEGER,original_ready_at INTEGER,ready_at INTEGER,updated_at INTEGER,lease_expires_at INTEGER);
CREATE TABLE worker_sessions(id TEXT PRIMARY KEY,status TEXT,worker_type TEXT,worker_domain TEXT);
CREATE TABLE v2_ingest_candidates(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER);
CREATE TABLE v2_project_slot_access(id TEXT PRIMARY KEY,project_id TEXT,slot_key TEXT);
CREATE TABLE operational_policies(id TEXT PRIMARY KEY,rule_type TEXT,status TEXT,scope_level TEXT,project_id TEXT,preset TEXT,priority INTEGER,updated_at INTEGER);
CREATE TABLE v2_production_slots(id TEXT PRIMARY KEY,project_id TEXT,version INTEGER,status TEXT,updated_at INTEGER,reference_pool_id TEXT);
CREATE TABLE v2_project_workflow_tags(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,tag TEXT,lease_expires_at INTEGER,updated_at INTEGER);
CREATE TABLE v2_slot_tags(id TEXT PRIMARY KEY,project_id TEXT,tag_key TEXT,active INTEGER,updated_at INTEGER);
CREATE TABLE v2_project_media(id TEXT PRIMARY KEY,project_id TEXT,kind TEXT,status TEXT,selected INTEGER,updated_at INTEGER);
CREATE TABLE v2_project_titles(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,slot_index INTEGER,updated_at INTEGER);
CREATE TABLE v2_download_packages(id TEXT PRIMARY KEY,project_id TEXT,type TEXT,status TEXT,created_at INTEGER);
CREATE TABLE v2_schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
''')
apply_ok=True
try:
    con.executescript(mig)
except Exception as e:
    apply_ok=False

indexes={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
expected_indexes={
 'idx_automatic_projects_actionable','idx_project_items_project_status','idx_project_items_project_priority','idx_project_files_project_role',
 'idx_worker_ready_claim','idx_worker_project_item_active','idx_worker_project_status','idx_worker_lease_expiry','idx_worker_status_type_domain',
 'idx_v2_ingest_candidates_project_status','idx_v2_production_slot_project_version_status','idx_v2_project_workflow_tag_lookup',
 'idx_v2_slot_tags_project_key_active','idx_v2_project_media_lookup','idx_v2_project_titles_lookup','idx_v2_download_packages_project_type_status',
 'idx_v2_mcp_route_telemetry_created','idx_v2_mcp_route_telemetry_tool_created'
}

def plan(sql,params=()):
    return ' | '.join(str(row[3]) for row in con.execute('EXPLAIN QUERY PLAN '+sql,params))
plans={
 'actionable': plan("SELECT id FROM automatic_projects WHERE COALESCE(lifecycle_status,'ACTIVE')='ACTIVE' AND next_action IS NOT NULL ORDER BY queue_priority DESC,updated_at ASC,id ASC LIMIT 25"),
 'pitems': plan("SELECT id FROM automatic_project_items WHERE project_id=? AND status=? ORDER BY priority DESC,updated_at DESC",('P','COLLECTING')),
 'worker_claim': plan("SELECT id FROM worker_work_items WHERE status='READY' AND worker_type=? AND project_domain=? ORDER BY resume_priority DESC,priority DESC,original_ready_at ASC,ready_at ASC LIMIT 1",('DISCOVERY','ANIME')),
 'pslots': plan("SELECT id FROM v2_production_slots WHERE project_id=? AND version=? AND status=? ORDER BY updated_at DESC",('P',1,'FROZEN')),
 'slot_tags': plan("SELECT id FROM v2_slot_tags WHERE project_id=? AND tag_key=? AND active=1 ORDER BY updated_at DESC",('P','REVISAR')),
 'files': plan("SELECT id FROM automatic_project_files WHERE project_id=? AND role=? ORDER BY version DESC,created_at DESC LIMIT 1",('P','SCRIPT')),
}
checks={
 'migration_applies_to_2_26_shape': apply_ok,
 'production_reconciled_at_added': 'production_reconciled_at' in {r[1] for r in con.execute('PRAGMA table_info(automatic_projects)')},
 'telemetry_table_created': bool(con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v2_mcp_route_telemetry'").fetchone()),
 'all_expected_indexes_created': expected_indexes.issubset(indexes),
 'schema_version_2_27': con.execute("SELECT value FROM v2_schema_meta WHERE key='schema_version'").fetchone()[0]=='2.27.0',
 'actionable_query_uses_index': 'idx_automatic_projects_actionable' in plans['actionable'],
 'pitem_query_uses_index': 'idx_project_items_project_status' in plans['pitems'],
 'worker_claim_uses_index': 'idx_worker_ready_claim' in plans['worker_claim'],
 'pslot_query_uses_index': 'idx_v2_production_slot_project_version_status' in plans['pslots'],
 'slot_tag_query_uses_index': 'idx_v2_slot_tags_project_key_active' in plans['slot_tags'],
 'file_query_uses_index': 'idx_project_files_project_role' in plans['files'],
 'boot_reconcile_prevents_duplicate_column_replay': 'd1ReadOptimizationMigration' in control and 'schema_contract_reconciled' in control,
 'restore_reconcile_prevents_duplicate_column_replay': 'd1ReadOptimizationMigration' in restore and 'schema_contract_reconciled' in restore,
 'schema_contract_recreates_indexes_before_marking_ready': all(x in contract for x in expected_indexes if x not in {'idx_v2_mcp_route_telemetry_created','idx_v2_mcp_route_telemetry_tool_created'}),
}
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.53','schema':'2.27.0','gate':'migration 9027 + query-plan index coverage','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'plans':plans,'checks':checks}
(root/'MIGRATION_GATE_0_20_53_D1_READ_OPTIMIZATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
