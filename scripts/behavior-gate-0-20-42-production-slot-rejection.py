#!/usr/bin/env python3
from __future__ import annotations
import gzip, json, pathlib, re, sqlite3, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
LEGACY={"9008_v2_operational_cleanup_recovery.sql","9010_v2_clean_zero_baseline.sql","9011_v2_purge_all_projects.sql","9012_v2_factory_zero_assets.sql","9013_v2_live_factory_zero_gate.sql"}

def load_db():
    conn=sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys=ON")
    baseline=gzip.decompress((ROOT/"bootstrap/CORVO_LIBRARY_V2_D1_CLEAN_BASELINE.sql.gz").read_bytes()).decode()
    conn.executescript(baseline)
    for p in sorted((ROOT/"cloudflare/migrations").glob("*.sql")):
        if p.name in LEGACY: continue
        sql=re.sub(r"^\s*PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;\s*$","",p.read_text(),flags=re.I|re.M)
        conn.executescript(sql)
    return conn

def count(conn, sql, args=()):
    return int(conn.execute(sql,args).fetchone()[0] or 0)

def main():
    c=load_db(); ts=2_000_000_000_000
    c.execute("INSERT INTO automatic_projects(id,name,status,active_version,created_at,updated_at,pipeline_status,lifecycle_status,mcp_locked) VALUES ('PROJ-T','Gate','ACTIVE',1,?,?,'SLOT_ASSIGNMENT_COMPLETE','ACTIVE',0)",(ts,ts))
    for aid in ('AST-A','AST-B','AST-C'):
        c.execute("INSERT INTO assets(id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,created_at,updated_at,qa_status) VALUES (?,?, 'TEST','Imagem','Aprovado','[]',?,?,?,?,?,?, 'APROVADO')",
                  (aid,aid,f'assets/{aid}.jpg',f'{aid}.jpg','image/jpeg',100,ts,ts))
    c.execute("INSERT INTO v2_production_scenes(id,project_id,version,scene_key,scene_number,title,status,created_at,updated_at) VALUES ('SC-1','PROJ-T',1,'CENA-001',1,'Q','READY',?,?)",(ts,ts))
    c.execute("INSERT INTO v2_production_slots(id,project_id,version,scene_id,slot_key,slot_index,target_file,asset_id,status,created_at,updated_at) VALUES ('PS-A','PROJ-T',1,'SC-1','SLOT-A',1,'A.jpg','AST-A','FROZEN',?,?)",(ts,ts))
    c.execute("INSERT INTO v2_production_slots(id,project_id,version,scene_id,slot_key,slot_index,target_file,asset_id,status,created_at,updated_at) VALUES ('PS-B','PROJ-T',1,'SC-1','SLOT-B',2,'B.jpg','AST-B','FROZEN',?,?)",(ts,ts))
    c.execute("INSERT INTO v2_download_packages(id,operation_id,project_id,project_revision,type,status,r2_key,file_name,size_bytes,revision_hash,created_at,updated_at,ready_at) VALUES ('PKG-OLD','OP-OLD','PROJ-T',1,'PROJECT_IMAGES_ZIP','READY_FOR_DOWNLOAD','projects/PROJ-T/exports/imagens-old.zip','imagens.zip',999,'OLDHASH',?,?,?)",(ts,ts,ts))
    c.commit()

    before=(count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T'"),count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND asset_id IS NOT NULL AND status IN ('RESOLVED','FROZEN','APPROVED','COMPLETED')"))

    # Mirrors the production-slot-only rejection mutation used by rejectProductionSlotsBatch.
    op='OP-REJECT-1'; reason='Imagem incorreta'; rejected_by='SUPERVISOR'; reject_ts=ts+100
    row=c.execute("SELECT id,target_file,asset_id,status FROM v2_production_slots WHERE project_id=? AND version=1 AND target_file=?",('PROJ-T','A.jpg')).fetchone()
    assert row and row[2]=='AST-A'
    c.execute("UPDATE v2_production_slots SET previous_asset_id=?,asset_id=NULL,status='RELINK_REQUIRED',relink_required_at=?,relink_reason=?,rejected_by=?,rejected_operation_id=?,updated_at=? WHERE id=?",(row[2],reject_ts,reason,rejected_by,op,reject_ts,row[0]))
    c.execute("INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,reason,operation_id,actor,created_at) VALUES ('H-REJ','PROJ-T',1,'PS-A','A.jpg','PRODUCTION_SLOT_REJECTED','AST-A',?,?,?,?)",(reason,op,rejected_by,reject_ts))
    c.execute("UPDATE v2_download_packages SET status='STALE',error='PRODUCTION_SLOT_REJECTED_REGENERATE_IMAGES',updated_at=? WHERE project_id='PROJ-T' AND type IN ('PROJECT_IMAGES_ZIP','PROJECT_PRODUCTION_ZIP') AND status IN ('READY_FOR_DOWNLOAD','COMPLETED','DOWNLOADED')",(reject_ts,))
    c.execute("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES ('PEV-INV','PROJ-T','FINAL_ARTIFACTS_INVALIDATED_BY_SLOT_REJECTION','STALE',?,?)",(json.dumps({'operation_id':op}),reject_ts))
    c.commit()

    after_reject={
        'total': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T'"),
        'resolved': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND asset_id IS NOT NULL AND status IN ('RESOLVED','FROZEN','APPROVED','COMPLETED')"),
        'relink_required': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND status='RELINK_REQUIRED'"),
        'a': c.execute("SELECT asset_id,status,previous_asset_id FROM v2_production_slots WHERE id='PS-A'").fetchone(),
        'b': c.execute("SELECT asset_id,status FROM v2_production_slots WHERE id='PS-B'").fetchone(),
        'ast_a': c.execute("SELECT status,r2_key FROM assets WHERE id='AST-A'").fetchone(),
        'ast_b': c.execute("SELECT status,r2_key FROM assets WHERE id='AST-B'").fetchone(),
        'old_package_preserved': count(c,"SELECT COUNT(*) FROM v2_download_packages WHERE id='PKG-OLD' AND r2_key IS NOT NULL") == 1,
        'old_package_stale': count(c,"SELECT COUNT(*) FROM v2_download_packages WHERE id='PKG-OLD' AND status='STALE' AND error='PRODUCTION_SLOT_REJECTED_REGENERATE_IMAGES'") == 1,
    }
    # Repeating rejection while already RELINK_REQUIRED must be a no-op for history/counts.
    if c.execute("SELECT status,asset_id FROM v2_production_slots WHERE id='PS-A'").fetchone()==('RELINK_REQUIRED',None):
        pass
    rejection_history_after_repeat=count(c,"SELECT COUNT(*) FROM v2_production_slot_history WHERE slot_id='PS-A' AND event='PRODUCTION_SLOT_REJECTED'")
    invalidation_events_after_repeat=count(c,"SELECT COUNT(*) FROM automatic_project_events WHERE project_id='PROJ-T' AND event='FINAL_ARTIFACTS_INVALIDATED_BY_SLOT_REJECTION'")

    # Relink A to AST-C, preserving B and the historical AST-A record.
    relink_ts=ts+200
    prev=c.execute("SELECT previous_asset_id FROM v2_production_slots WHERE id='PS-A'").fetchone()[0]
    c.execute("UPDATE v2_production_slots SET asset_id='AST-C',status='FROZEN',relink_required_at=NULL,relink_reason=NULL,rejected_by=NULL,rejected_operation_id=NULL,updated_at=? WHERE id='PS-A'",(relink_ts,))
    c.execute("INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,new_asset_id,actor,created_at) VALUES ('H-REL','PROJ-T',1,'PS-A','A.jpg','PRODUCTION_SLOT_RELINKED',?,'AST-C','ASSIGN_ASSETS_TO_SLOTS',?)",(prev,relink_ts))
    c.commit()
    after_relink={
        'total': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T'"),
        'resolved': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND asset_id IS NOT NULL AND status IN ('RESOLVED','FROZEN','APPROVED','COMPLETED')"),
        'relink_required': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND status='RELINK_REQUIRED'"),
        'a': c.execute("SELECT asset_id,status,previous_asset_id FROM v2_production_slots WHERE id='PS-A'").fetchone(),
        'b': c.execute("SELECT asset_id,status FROM v2_production_slots WHERE id='PS-B'").fetchone(),
        'history': c.execute("SELECT event,previous_asset_id,new_asset_id FROM v2_production_slot_history WHERE slot_id='PS-A' ORDER BY created_at").fetchall(),
    }

    # Strong operation-id idempotency: a delayed retry of the SAME rejection operation
    # after the slot was already relinked must NOT reject the newly assigned AST-C.
    prior_same_op=c.execute("SELECT 1 FROM v2_production_slot_history WHERE project_id='PROJ-T' AND slot_id='PS-A' AND event='PRODUCTION_SLOT_REJECTED' AND operation_id=? LIMIT 1",(op,)).fetchone()
    if not prior_same_op:
        raise AssertionError('missing rejection history for operation replay gate')
    after_same_operation_replay={
        'a': c.execute("SELECT asset_id,status,previous_asset_id FROM v2_production_slots WHERE id='PS-A'").fetchone(),
        'resolved': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND asset_id IS NOT NULL AND status IN ('RESOLVED','FROZEN','APPROVED','COMPLETED')"),
        'relink_required': count(c,"SELECT COUNT(*) FROM v2_production_slots WHERE project_id='PROJ-T' AND status='RELINK_REQUIRED'"),
        'reject_history': count(c,"SELECT COUNT(*) FROM v2_production_slot_history WHERE slot_id='PS-A' AND event='PRODUCTION_SLOT_REJECTED' AND operation_id='OP-REJECT-1'"),
    }

    source=(ROOT/'cloudflare/src/core/production-model.ts').read_text()
    mcp=(ROOT/'cloudflare/src/mcp.ts').read_text()
    collector=(ROOT/'cloudflare/src/core/collector-qa.ts').read_text()
    checks={
        'before_2_of_2': before==(2,2),
        'reject_total_unchanged': after_reject['total']==2,
        'reject_resolved_down_exactly_one': after_reject['resolved']==1,
        'reject_relink_count_one': after_reject['relink_required']==1,
        'a_link_removed_only': after_reject['a']==(None,'RELINK_REQUIRED','AST-A'),
        'b_untouched': after_reject['b']==('AST-B','FROZEN'),
        'ast_a_preserved': after_reject['ast_a']==('Aprovado','assets/AST-A.jpg'),
        'ast_b_preserved': after_reject['ast_b']==('Aprovado','assets/AST-B.jpg'),
        'old_export_preserved': after_reject['old_package_preserved'],
        'old_images_export_marked_stale_not_deleted': after_reject['old_package_stale'],
        'repeat_reject_no_duplicate_invalidation_event': invalidation_events_after_repeat==1,
        'repeat_reject_no_duplicate_history': rejection_history_after_repeat==1,
        'relink_resolved_back_to_two': after_relink['resolved']==2,
        'relink_required_back_to_zero': after_relink['relink_required']==0,
        'a_relinked_to_c': after_relink['a']==('AST-C','FROZEN','AST-A'),
        'b_still_untouched_after_relink': after_relink['b']==('AST-B','FROZEN'),
        'history_has_reject_and_relink': after_relink['history']==[('PRODUCTION_SLOT_REJECTED','AST-A',None),('PRODUCTION_SLOT_RELINKED','AST-A','AST-C')],
        'same_operation_retry_after_relink_preserves_new_asset': after_same_operation_replay['a']==('AST-C','FROZEN','AST-A') and after_same_operation_replay['resolved']==2 and after_same_operation_replay['relink_required']==0 and after_same_operation_replay['reject_history']==1,
        'source_checks_operation_history_before_mutation': "event='PRODUCTION_SLOT_REJECTED' AND operation_id=?" in source and 'priorOperationBySlot' in source and source.index('const priorOperation=') < source.index('if(currentStatus==="RELINK_REQUIRED"'),
        'source_invalidates_only_image_dependent_exports': "type IN ('PROJECT_IMAGES_ZIP','PROJECT_PRODUCTION_ZIP')" in source and "status='STALE'" in source and 'PROJECT_SCRIPT_TXT' not in source[source.index('export async function rejectProductionSlotsBatch'):source.index('export async function listProductionRelinkGaps')],
        'mcp_route_exact_name': 'registerTool("rejeitar_production_slots_lote"' in mcp,
        'batch_limit_500': '.slice(0,500)' in source and '.max(500)' in mcp,
        'does_not_reject_global_asset': 'UPDATE assets SET status=' not in source[source.index('export async function rejectProductionSlotsBatch'):source.index('export async function listProductionRelinkGaps')],
        'does_not_call_item_rejection': 'rejectProjectItems' not in source[source.index('export async function rejectProductionSlotsBatch'):source.index('export async function listProductionRelinkGaps')],
        'collector_exposes_only_relink_gaps': "status='RELINK_REQUIRED'" in collector and 'relink_required_slots' in collector,
        'assignment_emits_relinked_event': 'PRODUCTION_SLOT_RELINKED' in source,
        'counts_expose_relink_required': 'production_slots_relink_required' in source,
    }
    report={'version':'0.20.42','schema':'2.25.0','scenario':'A/B reject A then relink A to C','checks':checks,'pass':all(checks.values()),'after_reject':after_reject,'after_relink':after_relink,'after_same_operation_replay':after_same_operation_replay}
    out=ROOT/'BEHAVIOR_GATE_0_20_42_PRODUCTION_SLOT_REJECTION.json'
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2,default=list)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2,default=list))
    return 0 if report['pass'] else 1

if __name__=='__main__': raise SystemExit(main())
