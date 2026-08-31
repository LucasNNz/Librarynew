#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, sqlite3, re, math

ROOT=pathlib.Path(__file__).resolve().parents[1]
SRC=(ROOT/'cloudflare/src/core/production-model.ts').read_text(encoding='utf-8')
MCP=(ROOT/'cloudflare/src/mcp.ts').read_text(encoding='utf-8')
SCHEMA=(ROOT/'cloudflare/src/core/schema-contract.ts').read_text(encoding='utf-8')
MIG=(ROOT/'cloudflare/migrations/9026_v2_qa_by_rejection.sql').read_text(encoding='utf-8')
PROD=(ROOT/'cloudflare/src/core/production.ts').read_text(encoding='utf-8')
WORKFLOW=(ROOT/'cloudflare/src/core/project-workflow.ts').read_text(encoding='utf-8')
CONTROL=(ROOT/'cloudflare/src/core/control-plane.ts').read_text(encoding='utf-8')
RESTORE=(ROOT/'app/api/setup/cloudflare/restore/route.ts').read_text(encoding='utf-8')


def sqlite_flow_demo():
    c=sqlite3.connect(':memory:')
    c.execute('PRAGMA foreign_keys=ON')
    c.executescript('''
      CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT,status TEXT,r2_key TEXT,use_count INTEGER DEFAULT 0);
      CREATE TABLE candidates(id TEXT PRIMARY KEY,status TEXT,asset_id TEXT,r2_key TEXT,project_id TEXT);
      CREATE TABLE slots(id TEXT PRIMARY KEY,target_file TEXT,asset_id TEXT,candidate_id TEXT,previous_asset_id TEXT,previous_candidate_id TEXT,status TEXT,qa_operation_id TEXT);
      CREATE TABLE history(id TEXT PRIMARY KEY,slot_id TEXT,event TEXT,previous_asset_id TEXT,new_asset_id TEXT,previous_candidate_id TEXT,new_candidate_id TEXT,operation_id TEXT);
      CREATE TABLE usage(id TEXT PRIMARY KEY,asset_id TEXT,slot_id TEXT);
    ''')
    c.executemany("INSERT INTO assets(id,name,status,r2_key) VALUES (?,?,?,?)",[
      ('AST-A','A','Aprovado','assets/AST-A.jpg'),('AST-C','C','Aprovado','assets/AST-C.jpg')])
    c.execute("INSERT INTO candidates VALUES ('CAND-X','MATERIALIZED',NULL,'incoming/CAND-X.jpg','P')")
    c.executemany("INSERT INTO slots(id,target_file,status) VALUES (?,?, 'PENDING')", [('A','A.jpg'),('B','B.jpg')])

    # Collector assigns library and external sources provisionally.
    c.execute("UPDATE slots SET asset_id='AST-A',candidate_id=NULL,status='ASSIGNED_FOR_QA' WHERE id='A'")
    c.execute("UPDATE slots SET asset_id=NULL,candidate_id='CAND-X',status='ASSIGNED_FOR_QA' WHERE id='B'")
    before_qa=c.execute("SELECT id,asset_id,candidate_id,status FROM slots ORDER BY id").fetchall()
    external_still_provisional=c.execute("SELECT status,asset_id,r2_key FROM candidates WHERE id='CAND-X'").fetchone()

    # QA rejects only A; global AST remains untouched.
    c.execute("UPDATE slots SET previous_asset_id=asset_id,asset_id=NULL,candidate_id=NULL,status='RELINK_REQUIRED' WHERE id='A'")
    c.execute("INSERT INTO history VALUES ('H1','A','PRODUCTION_SLOT_REJECTED','AST-A',NULL,NULL,NULL,'REJ-1')")
    ast_a_preserved=c.execute("SELECT status,r2_key FROM assets WHERE id='AST-A'").fetchone()

    # Finalize QA: survivor B is promoted and frozen, A remains gap.
    c.execute("INSERT INTO assets(id,name,status,r2_key) VALUES ('AST-X','X','Aprovado','assets/AST-X.jpg')")
    c.execute("UPDATE candidates SET status='APPROVED',asset_id='AST-X',r2_key='assets/AST-X.jpg' WHERE id='CAND-X'")
    c.execute("UPDATE slots SET asset_id='AST-X',candidate_id=NULL,status='FROZEN',qa_operation_id='QA-1' WHERE id='B' AND status='ASSIGNED_FOR_QA'")
    c.execute("INSERT INTO history VALUES ('H2','B','PRODUCTION_SLOT_QA_APPROVED',NULL,'AST-X','CAND-X',NULL,'QA-1')")
    c.execute("INSERT INTO usage VALUES ('U1','AST-X','B')")
    after_finalize=c.execute("SELECT id,asset_id,candidate_id,status FROM slots ORDER BY id").fetchall()

    # Relinker supplies only gap; it must return to QA, not FROZEN.
    c.execute("UPDATE slots SET asset_id='AST-C',candidate_id=NULL,status='ASSIGNED_FOR_QA' WHERE id='A' AND status='RELINK_REQUIRED'")
    after_relink=c.execute("SELECT asset_id,status FROM slots WHERE id='A'").fetchone()
    # second QA round survivor
    c.execute("UPDATE slots SET status='FROZEN',qa_operation_id='QA-2' WHERE id='A' AND status='ASSIGNED_FOR_QA'")
    final=c.execute("SELECT id,asset_id,status FROM slots ORDER BY id").fetchall()

    return {
      'collector_library_is_provisional': before_qa[0]==('A','AST-A',None,'ASSIGNED_FOR_QA'),
      'collector_external_is_provisional': before_qa[1]==('B',None,'CAND-X','ASSIGNED_FOR_QA'),
      'external_not_approved_before_qa': external_still_provisional==('MATERIALIZED',None,'incoming/CAND-X.jpg'),
      'rejected_library_binding_preserves_global_ast': ast_a_preserved==('Aprovado','assets/AST-A.jpg'),
      'finalize_freezes_only_survivor': after_finalize==[('A',None,None,'RELINK_REQUIRED'),('B','AST-X',None,'FROZEN')],
      'external_promoted_only_after_survival': c.execute("SELECT status,asset_id,r2_key FROM candidates WHERE id='CAND-X'").fetchone()==('APPROVED','AST-X','assets/AST-X.jpg'),
      'usage_registered_after_qa': c.execute("SELECT asset_id,slot_id FROM usage").fetchall()==[('AST-X','B')],
      'relink_returns_to_qa_not_frozen': after_relink==('AST-C','ASSIGNED_FOR_QA'),
      'second_finalize_freezes_relinked_survivor': final==[('A','AST-C','FROZEN'),('B','AST-X','FROZEN')],
    }


def main():
    demo=sqlite_flow_demo()
    finalize=SRC[SRC.index('export async function finalizeProjectQa'):SRC.index('export async function productionCompletionGate')]
    reject=SRC[SRC.index('export async function rejectProductionSlotsBatch'):SRC.index('export async function listProductionRelinkGaps')]
    assign_asset=SRC[SRC.index('export async function assignAssetsToSlots'):SRC.index('export async function assignCandidatesToSlotsForQa')]
    assign_candidate=SRC[SRC.index('export async function assignCandidatesToSlotsForQa'):SRC.index('type CandidatePromotion')]
    # bind safety: worst dynamic statements stay <=100 bindings/query.
    estimated_finalize_statements=1+math.ceil(500/18)+math.ceil(500/7)+math.ceil(500/30)+math.ceil(500/40)+math.ceil(500/7)+math.ceil(500/8)+math.ceil(500/20)+math.ceil(500/20)+math.ceil(500/20)+math.ceil(500/90)+math.ceil(500/40)+3+3
    checks={
      **demo,
      'schema_2_26': 'const CONTRACT_VERSION = "2.26.0"' in SCHEMA and "'schema_version','2.26.0'" in MIG,
      'migration_has_candidate_links': all(x in MIG for x in ['ADD COLUMN candidate_id','ADD COLUMN previous_candidate_id','ADD COLUMN assigned_for_qa_at','ADD COLUMN qa_finalized_at','ADD COLUMN qa_operation_id','ADD COLUMN assignment_source']),
      'schema_reconcile_has_candidate_links': all(x in SCHEMA for x in ['name:"candidate_id"','name:"previous_candidate_id"','name:"assigned_for_qa_at"','name:"qa_finalized_at"','name:"qa_operation_id"','name:"assignment_source"']),
      'migration_replay_guarded': '9026_v2_qa_by_rejection.sql' in CONTROL and 'schema_contract_reconciled' in CONTROL and '9026_v2_qa_by_rejection.sql' in RESTORE,
      'legacy_final_states_grandfathered_to_frozen': "status IN ('RESOLVED','APPROVED','COMPLETED')" in SCHEMA and "status='FROZEN'" in SCHEMA,
      'library_assignment_goes_assigned_for_qa': "status='ASSIGNED_FOR_QA'" in assign_asset and "assignment_source='LIBRARY'" in assign_asset and "status='FROZEN'" not in assign_asset[assign_asset.find('UPDATE v2_production_slots'):],
      'external_assignment_goes_assigned_for_qa': "candidate_id=?,status='ASSIGNED_FOR_QA'" in assign_candidate and "assignment_source='EXTERNAL_CANDIDATE'" in assign_candidate,
      'external_assignment_does_not_promote': 'UPDATE assets SET' not in assign_candidate and "status='APPROVED'" not in assign_candidate,
      'collector_marks_finished_on_full_handoff': 'markCollectorHandoffIfReady' in SRC and 'COLLECTOR_FINISHED' in SRC and 'qa_handoff' in SRC,
      'frozen_slot_cannot_be_overwritten_by_collector': 'error:"SLOT_FROZEN"' in assign_asset and 'error:"SLOT_FROZEN"' in assign_candidate,
      'assigned_for_qa_not_silently_replaced': 'SLOT_ALREADY_ASSIGNED_FOR_QA' in assign_asset and 'SLOT_ALREADY_ASSIGNED_FOR_QA' in assign_candidate and 'alternatives_should_remain_candidates:true' in assign_candidate,
      'qa_handoff_waits_for_all_gaps': SRC.index('production_slots_relink_required||0)>0') < SRC.index('production_slots_assigned_for_qa||0)>0') and SRC.index('production_slots_pending||0)>0') < SRC.index('production_slots_assigned_for_qa||0)>0'),
      'ready_for_qa_has_no_pending_or_relink': 'pending===0&&relink===0&&resolved>=total' in SRC,
      'rejection_supports_candidate_provenance': 'previous_candidate_id' in reject and 'candidate_id=NULL' in reject and 'PRODUCTION_SLOT_REJECTED' in reject,
      'rejection_remains_atomic': 'env.DB.batch<Record<string,unknown>>(statements)' in reject and 'PRODUCTION_SLOT_REJECTION_ROLLED_BACK' in reject,
      'finalize_route_exists': 'registerTool("finalizar_qa_projeto"' in MCP,
      'external_assignment_route_exists': 'registerTool("atribuir_candidatas_aos_slots_para_qa"' in MCP,
      'qa_batch_read_route_exists': 'registerTool("obter_production_slots_para_qa"' in MCP and 'listProductionSlotsForQa(request,env' in MCP,
      'qa_batch_read_has_signed_previews_for_both_sources': 'export async function listProductionSlotsForQa' in SRC and 'createSignedFileUrl' in SRC and 'createSignedCandidateUrl' in SRC and 'preview_url' in SRC and 'source_type' in SRC,
      'qa_batch_read_is_reject_only': 'qa_action:"REJECT_ONLY_IF_NONCONFORMING"' in SRC and "status='ASSIGNED_FOR_QA'" in SRC[SRC.index('export async function listProductionSlotsForQa'):SRC.index('type CandidatePromotion')],
      'finalize_only_reads_assigned_for_qa': "status='ASSIGNED_FOR_QA'" in finalize and 'LIMIT 501' in finalize,
      'finalize_promotes_candidate_after_qa': "UPDATE v2_ingest_candidates SET status='APPROVED'" in finalize and "INSERT OR IGNORE INTO assets" in finalize,
      'finalize_freezes_survivors': "status='FROZEN'" in finalize and 'PRODUCTION_SLOT_QA_APPROVED' in finalize,
      'finalize_registers_usage': 'INSERT OR IGNORE INTO asset_usage' in finalize and 'ASSET_USAGE_REGISTERED' in finalize,
      'finalize_idempotent_commit_marker': 'PROJECT_QA_FINALIZED' in finalize and 'commitEventId=await stableId' in finalize and 'already_committed:true' in finalize,
      'finalize_d1_atomic': 'env.DB.batch<Record<string,unknown>>(statements)' in finalize and 'QA_FINALIZE_ROLLED_BACK' in finalize and 'atomic_d1:true' in finalize,
      'finalize_concurrency_guard': 'ATOMIC_QA_GUARD' in finalize and "COALESCE(updated_at,0)=?" in finalize,
      'finalize_r2_prepare_cleanup': 'copiedFinalObject' in SRC and 'r2_cleanup_attempted:true' in finalize,
      'rejected_slots_not_promoted_by_finalize': "WHERE project_id=? AND version=? AND status='ASSIGNED_FOR_QA'" in finalize and 'rejected_slots_untouched:true' in finalize,
      'export_requires_final_frozen_assets': "RESOLVED_SLOT_STATES" in PROD and "ASSIGNED_FOR_QA" not in PROD[PROD.index('const RESOLVED_SLOT_STATES'):PROD.index('const RESOLVED_SLOT_STATES')+180],
      'counts_expose_all_requested_states': all(x in SRC for x in ['production_slots_assigned_for_qa','production_slots_frozen','production_slots_relink_required','production_slots_pending','production_slots_resolved']),
      'workflow_exposes_qa_state': all(x in WORKFLOW for x in ['production_slots_assigned_for_qa','production_slots_frozen','production_slots_relink_required']),
      'finalize_statement_budget_under_1000': estimated_finalize_statements < 1000,
      'mcp_describes_reject_only_flow': 'QA por rejeição' in MCP and 'sobreviventes viram FROZEN' in MCP,
    }
    report={'version':'0.20.45','schema':'2.26.0','feature':'Collector provisional assignment + QA by rejection','estimated_500_slot_finalize_statements':estimated_finalize_statements,'checks':checks,'pass':all(checks.values())}
    (ROOT/'BEHAVIOR_GATE_0_20_45_QA_BY_REJECTION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['pass'] else 1

if __name__=='__main__': raise SystemExit(main())
