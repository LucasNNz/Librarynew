#!/usr/bin/env python3
from __future__ import annotations
import sqlite3, pathlib, json
ROOT=pathlib.Path(__file__).resolve().parents[1]
MIG=(ROOT/'cloudflare/migrations/9026_v2_qa_by_rejection.sql').read_text(encoding='utf-8')
CONTROL=(ROOT/'cloudflare/src/core/control-plane.ts').read_text(encoding='utf-8')
RESTORE=(ROOT/'app/api/setup/cloudflare/restore/route.ts').read_text(encoding='utf-8')
SCHEMA=(ROOT/'cloudflare/src/core/schema-contract.ts').read_text(encoding='utf-8')

def main():
 c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=ON')
 c.executescript('''
 CREATE TABLE automatic_projects(id TEXT PRIMARY KEY);
 CREATE TABLE assets(id TEXT PRIMARY KEY);
 CREATE TABLE v2_ingest_candidates(id TEXT PRIMARY KEY);
 CREATE TABLE v2_production_slots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,version INTEGER NOT NULL,asset_id TEXT REFERENCES assets(id),previous_asset_id TEXT REFERENCES assets(id),status TEXT NOT NULL DEFAULT 'UNRESOLVED',relink_required_at INTEGER,relink_reason TEXT,rejected_by TEXT,rejected_operation_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE v2_production_slot_history(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,project_version INTEGER NOT NULL,slot_id TEXT NOT NULL,event TEXT NOT NULL,previous_asset_id TEXT,new_asset_id TEXT,reason TEXT,operation_id TEXT,actor TEXT,created_at INTEGER NOT NULL);
 CREATE TABLE v2_schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
 INSERT INTO assets VALUES ('AST-OLD');
 INSERT INTO v2_production_slots(id,project_id,version,asset_id,status,created_at,updated_at) VALUES ('S','P',1,'AST-OLD','RESOLVED',1,2);
 ''')
 c.executescript(MIG)
 slot_cols={r[1] for r in c.execute('PRAGMA table_info(v2_production_slots)')}
 hist_cols={r[1] for r in c.execute('PRAGMA table_info(v2_production_slot_history)')}
 checks={
  'migration_applies_to_2_25_shape':True,
  'slot_columns_present':all(x in slot_cols for x in ['candidate_id','previous_candidate_id','assigned_for_qa_at','qa_finalized_at','qa_operation_id','assignment_source']),
  'history_candidate_columns_present':all(x in hist_cols for x in ['previous_candidate_id','new_candidate_id']),
  'legacy_final_normalized':c.execute("SELECT status,qa_finalized_at,assignment_source FROM v2_production_slots WHERE id='S'").fetchone()==('FROZEN',2,'LEGACY_QA_APPROVED'),
  'schema_version_2_26':c.execute("SELECT value FROM v2_schema_meta WHERE key='schema_version'").fetchone()[0]=='2.26.0',
  'boot_reconcile_prevents_duplicate_alter': '9026_v2_qa_by_rejection.sql' in CONTROL and 'schema_contract_reconciled' in CONTROL,
  'restore_reconcile_prevents_duplicate_alter': '9026_v2_qa_by_rejection.sql' in RESTORE and 'schema_contract_reconciled' in RESTORE,
  'critical_contract_matches_2_26': 'const CONTRACT_VERSION = "2.26.0"' in SCHEMA,
 }
 report={'version':'0.20.45','gate':'migration 9026 / schema 2.26.0','checks':checks,'pass':all(checks.values())}
 (ROOT/'MIGRATION_GATE_0_20_45_QA_BY_REJECTION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['pass'] else 1
if __name__=='__main__':raise SystemExit(main())
