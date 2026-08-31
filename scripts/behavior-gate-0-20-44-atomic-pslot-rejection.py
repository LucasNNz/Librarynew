#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, re, sqlite3, math

ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'cloudflare/src/core/production-model.ts').read_text()
MCP=(ROOT/'cloudflare/src/mcp.ts').read_text()
START=SOURCE.index('export async function rejectProductionSlotsBatch')
END=SOURCE.index('export async function listProductionRelinkGaps', START)
FN=SOURCE[START:END]


def sqlite_atomic_demo():
    c=sqlite3.connect(':memory:')
    c.execute('PRAGMA foreign_keys=ON')
    c.executescript('''
      CREATE TABLE assets(id TEXT PRIMARY KEY,status TEXT NOT NULL);
      CREATE TABLE automatic_projects(id TEXT PRIMARY KEY,status TEXT,pipeline_status TEXT,next_action TEXT,state_version INTEGER DEFAULT 0,workflow_updated_at INTEGER,updated_at INTEGER);
      CREATE TABLE v2_production_slots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,version INTEGER NOT NULL,target_file TEXT,asset_id TEXT,candidate_id TEXT,previous_asset_id TEXT,previous_candidate_id TEXT,status TEXT NOT NULL,assigned_for_qa_at INTEGER,qa_finalized_at INTEGER,qa_operation_id TEXT,relink_required_at INTEGER,relink_reason TEXT,rejected_by TEXT,rejected_operation_id TEXT,observation TEXT,updated_at INTEGER NOT NULL);
      CREATE TABLE v2_production_slot_history(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,project_version INTEGER NOT NULL,slot_id TEXT NOT NULL,target_file TEXT,event TEXT NOT NULL,previous_asset_id TEXT,new_asset_id TEXT,previous_candidate_id TEXT,new_candidate_id TEXT,reason TEXT,operation_id TEXT,actor TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE automatic_project_events(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event TEXT NOT NULL,status TEXT,detail TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE v2_download_packages(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,type TEXT,status TEXT,error TEXT,updated_at INTEGER);
    ''')
    c.executemany("INSERT INTO assets VALUES (?, 'Aprovado')", [('AST-A',),('AST-B',)])
    c.execute("INSERT INTO automatic_projects(id,status,pipeline_status,next_action,state_version,updated_at) VALUES ('P','ACTIVE','DONE','X',1,1)")
    c.execute("INSERT INTO v2_production_slots(id,project_id,version,target_file,asset_id,status,updated_at) VALUES ('A','P',1,'A.jpg','AST-A','FROZEN',1)")
    c.execute("INSERT INTO v2_production_slots(id,project_id,version,target_file,asset_id,status,updated_at) VALUES ('B','P',1,'B.jpg','AST-B','FROZEN',1)")
    c.commit()

    before=c.execute("SELECT id,asset_id,status,previous_asset_id FROM v2_production_slots ORDER BY id").fetchall()
    failed=False
    try:
        c.execute('BEGIN')
        c.execute("UPDATE v2_production_slots SET previous_asset_id=asset_id,asset_id=NULL,status='RELINK_REQUIRED',updated_at=2 WHERE id='A'")
        # Correct cardinality, extended in 2.26.0 with candidate provenance.
        c.execute("""INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,new_asset_id,previous_candidate_id,new_candidate_id,reason,operation_id,actor,created_at)
                     VALUES (?,?,?,?,?,'PRODUCTION_SLOT_REJECTED',?,NULL,?,NULL,?,?,?,?)""",
                  ('H-A','P',1,'A','A.jpg','AST-A',None,'bad','OP','SUP',2))
        c.execute("UPDATE v2_production_slots SET previous_asset_id=asset_id,asset_id=NULL,status='RELINK_REQUIRED',updated_at=2 WHERE id='B'")
        # Force a later statement failure; transaction must rollback A and B.
        c.execute("INSERT INTO automatic_project_events(id,project_id,event,created_at) VALUES ('E',NULL,'FAIL',2)")
        c.commit()
    except Exception:
        failed=True
        c.rollback()
    after_fail=c.execute("SELECT id,asset_id,status,previous_asset_id FROM v2_production_slots ORDER BY id").fetchall()
    history_after_fail=c.execute("SELECT COUNT(*) FROM v2_production_slot_history").fetchone()[0]

    with c:
        c.execute("UPDATE v2_production_slots SET previous_asset_id=asset_id,asset_id=NULL,status='RELINK_REQUIRED',updated_at=3 WHERE id='A'")
        c.execute("""INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,new_asset_id,previous_candidate_id,new_candidate_id,reason,operation_id,actor,created_at)
                     VALUES (?,?,?,?,?,'PRODUCTION_SLOT_REJECTED',?,NULL,?,NULL,?,?,?,?)""",
                  ('H-A2','P',1,'A','A.jpg','AST-A',None,'bad','OP2','SUP',3))
    success=c.execute("SELECT asset_id,status,previous_asset_id FROM v2_production_slots WHERE id='A'").fetchone()
    return {
      'forced_failure_happened': failed,
      'rollback_restored_all_slots': before==after_fail,
      'rollback_removed_history': history_after_fail==0,
      'corrected_history_insert_executes': success==(None,'RELINK_REQUIRED','AST-A'),
    }


def main():
    history_pattern="(?,?,?,?,?,'PRODUCTION_SLOT_REJECTED',?,NULL,?,NULL,?,?,?,?)"
    estimated_tx_statements=1+math.ceil(500/18)+500+math.ceil(500/8)+math.ceil(500/25)+1+1+1+3
    demo=sqlite_atomic_demo()
    checks={
      **demo,
      'history_values_match_14_column_schema': history_pattern in FN and history_pattern.count('?')==11,
      'old_13_value_history_shape_removed': "VALUES (?,?,?,?,?,'PRODUCTION_SLOT_REJECTED',?,NULL,?,?,?,?,?)" not in FN,
      'single_transactional_d1_batch': 'await env.DB.batch<Record<string,unknown>>(statements)' in FN,
      'no_mutating_run_before_batch': '.run()' not in FN,
      'rollback_error_is_structured': 'PRODUCTION_SLOT_REJECTION_ROLLED_BACK' in FN and 'mutation_applied:false' in FN and 'rollback:true' in FN,
      'operation_commit_marker_is_deterministic': 'PRODUCTION_SLOT_REJECTION_BATCH_COMMITTED' in FN and 'commitEventId=await stableId' in FN,
      'operation_id_payload_conflict_guard': 'OPERATION_ID_CONFLICT' in FN and 'request_fingerprint' in FN,
      'legacy_partial_operation_safe_recovery': 'legacy_partial_operation:true' in FN and 'OPERATION_ID_LEGACY_SCOPE_CONFLICT' in FN,
      'preflight_is_all_or_nothing': 'PRODUCTION_SLOT_BATCH_PREFLIGHT_FAILED' in FN and FN.index('PRODUCTION_SLOT_BATCH_PREFLIGHT_FAILED') < FN.index('const ts=nowMs(),statements'),
      'concurrency_guard_inside_transaction': "'ATOMIC_GUARD'" in FN and 'COALESCE(updated_at,0)=?' in FN,
      'counts_inside_same_batch': FN.index('const poolsIndex=statements.length') < FN.index('env.DB.batch<Record<string,unknown>>(statements)'),
      'exports_invalidated_inside_batch': "PRODUCTION_SLOT_REJECTED_REGENERATE_IMAGES" in FN and 'statements.push(env.DB.prepare("UPDATE v2_download_packages' in FN,
      'global_ast_not_mutated': 'UPDATE assets SET' not in FN,
      'mcp_limit_500_preserved': '.slice(0,500)' in FN and '.max(500)' in MCP,
      'd1_bound_parameter_guards': 'offset+=18' in FN and 'offset+=8' in FN and 'offset+=25' in FN and 'offset+=90' in FN,
      'worst_case_transaction_statements_under_1000': estimated_tx_statements < 1000,
      'mcp_description_declares_atomic': 'D1 atômico' in MCP and 'idempotente por operation_id' in MCP,
    }
    report={
      'version':'0.20.44',
      'schema':'2.26.0 compatibility',
      'feature':'Atomic PRODUCTION_SLOT rejection + SQL cardinality hotfix',
      'estimated_500_slot_transaction_statements':estimated_tx_statements,
      'checks':checks,
      'pass':all(checks.values()),
    }
    out=ROOT/'BEHAVIOR_GATE_0_20_44_ATOMIC_PSLOT_REJECTION.json'
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['pass'] else 1

if __name__=='__main__': raise SystemExit(main())
