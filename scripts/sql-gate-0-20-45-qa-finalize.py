#!/usr/bin/env python3
from __future__ import annotations
import sqlite3, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]

def db():
    c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=OFF')
    c.executescript('''
CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT,universe TEXT,kind TEXT,status TEXT,tags TEXT,r2_key TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,use_count INTEGER,created_at INTEGER,updated_at INTEGER,subject TEXT,source_url TEXT,qa_status TEXT,last_used_at INTEGER);
CREATE TABLE v2_ingest_candidates(id TEXT PRIMARY KEY,status TEXT,asset_id TEXT,r2_key TEXT,updated_at INTEGER);
CREATE TABLE v2_production_slots(id TEXT PRIMARY KEY,project_id TEXT,version INTEGER,target_file TEXT,scene_id TEXT,preset TEXT,context TEXT,reference_pool_id TEXT,asset_id TEXT,candidate_id TEXT,status TEXT,assignment_source TEXT,qa_finalized_at INTEGER,qa_operation_id TEXT,relink_required_at INTEGER,relink_reason TEXT,rejected_by TEXT,rejected_operation_id TEXT,updated_at INTEGER);
CREATE TABLE v2_production_slot_history(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,project_version INTEGER NOT NULL,slot_id TEXT NOT NULL,target_file TEXT,event TEXT NOT NULL,previous_asset_id TEXT,new_asset_id TEXT,previous_candidate_id TEXT,new_candidate_id TEXT,reason TEXT,operation_id TEXT,actor TEXT,created_at INTEGER NOT NULL);
CREATE TABLE asset_usage(id TEXT PRIMARY KEY,asset_id TEXT,project TEXT,block TEXT,preset TEXT,slot TEXT,role TEXT,script_reference TEXT,note TEXT,status TEXT,used_at INTEGER);
CREATE TABLE automatic_project_events(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event TEXT,status TEXT,detail TEXT,created_at INTEGER NOT NULL);
CREATE TABLE automatic_project_items(project_id TEXT,item_key TEXT,target_file TEXT,kind TEXT,linked_asset_id TEXT,status TEXT,stage TEXT,collection_status TEXT,qa_status TEXT,qa_completed_at INTEGER,updated_at INTEGER);
CREATE TABLE v2_download_packages(id TEXT PRIMARY KEY,project_id TEXT,type TEXT,status TEXT,error TEXT,updated_at INTEGER);
CREATE TABLE v2_reference_pools(id TEXT PRIMARY KEY,project_id TEXT,version INTEGER,status TEXT,updated_at INTEGER);
CREATE TABLE v2_production_scenes(id TEXT PRIMARY KEY,project_id TEXT,version INTEGER,status TEXT);
CREATE TABLE automatic_projects(id TEXT PRIMARY KEY,status TEXT,pipeline_status TEXT,next_action TEXT,state_version INTEGER,workflow_updated_at INTEGER,updated_at INTEGER);
''')
    c.execute("INSERT INTO automatic_projects VALUES ('P','ACTIVE','QA_REVIEW_WORKING','FINALIZE',1,1,1)")
    c.execute("INSERT INTO v2_reference_pools VALUES ('RP','P',1,'READY',1)")
    c.execute("INSERT INTO v2_production_scenes VALUES ('SC','P',1,'READY')")
    c.execute("INSERT INTO v2_ingest_candidates VALUES ('C','MATERIALIZED',NULL,'incoming/C.jpg',1)")
    c.execute("INSERT INTO v2_production_slots VALUES ('S','P',1,'S.jpg','SC','PRE','CTX','RP',NULL,'C','ASSIGNED_FOR_QA','EXTERNAL_CANDIDATE',NULL,NULL,NULL,NULL,NULL,NULL,1)")
    c.execute("INSERT INTO automatic_project_items(project_id,item_key,target_file,kind,status) VALUES ('P','S','S.jpg','production_slot_relink','ASSIGNED_FOR_QA')")
    c.commit();return c

def success_case():
    c=db();ts=10;op='QA1'
    stmts=[
      ("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,'PROJECT_QA_FINALIZED','COMMITTED',?,?)",('CE','P','{}',ts)),
      ("INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,event,created_at) SELECT ?,NULL,0,?,'ATOMIC_QA_GUARD',? WHERE NOT EXISTS(SELECT 1 FROM v2_production_slots WHERE id=? AND status='ASSIGNED_FOR_QA' AND COALESCE(asset_id,'')=? AND COALESCE(candidate_id,'')=? AND COALESCE(updated_at,0)=?)",('G','__ATOMIC_QA_GUARD__',ts,'S','','C',1)),
      ("INSERT OR IGNORE INTO assets(id,name,universe,kind,status,tags,r2_key,original_name,mime_type,size_bytes,use_count,created_at,updated_at,subject,source_url,qa_status) VALUES (?,?,?,?,'Aprovado',?,?,?,?,?,0,?,?,?,?,'APROVADO')",('AST-X','X','U','Imagem','[]','assets/AST-X/C.jpg','C.jpg','image/jpeg',123,ts,ts,'X','https://x')),
      (f"WITH changes(id,asset_id,r2_key) AS (VALUES (?,?,?)) UPDATE v2_ingest_candidates SET status='APPROVED',asset_id=(SELECT asset_id FROM changes WHERE changes.id=v2_ingest_candidates.id),r2_key=(SELECT r2_key FROM changes WHERE changes.id=v2_ingest_candidates.id),updated_at={ts} WHERE id IN (SELECT id FROM changes) AND status IN ('MATERIALIZED','APPROVED')",('C','AST-X','assets/AST-X/C.jpg')),
      (f"WITH changes(id,asset_id) AS (VALUES (?,?)) UPDATE v2_production_slots SET asset_id=(SELECT asset_id FROM changes WHERE changes.id=v2_production_slots.id),candidate_id=NULL,status='FROZEN',assignment_source=CASE WHEN candidate_id IS NOT NULL THEN 'EXTERNAL_PROMOTED_AFTER_QA' ELSE COALESCE(assignment_source,'LIBRARY') END,qa_finalized_at={ts},qa_operation_id=?,relink_required_at=NULL,relink_reason=NULL,rejected_by=NULL,rejected_operation_id=NULL,updated_at={ts} WHERE id IN (SELECT id FROM changes) AND status='ASSIGNED_FOR_QA'",('S','AST-X',op)),
      ("INSERT OR IGNORE INTO v2_production_slot_history(id,project_id,project_version,slot_id,target_file,event,previous_asset_id,new_asset_id,previous_candidate_id,new_candidate_id,reason,operation_id,actor,created_at) VALUES (?,?,?,?,?,'PRODUCTION_SLOT_QA_APPROVED',?,?,?,?,?,?,?,?)",('H','P',1,'S','S.jpg',None,'AST-X','C',None,'SURVIVED_QA_REJECTION_PASS',op,'QA',ts)),
      ("INSERT OR IGNORE INTO asset_usage(id,asset_id,project,block,preset,slot,role,script_reference,note,status,used_at) VALUES (?,?,?,?,?,?,?,?,?,'Registrado',?)",('U','AST-X','P','SC','PRE','S.jpg','PRODUCTION_SLOT','CTX','QA_BY_REJECTION_SURVIVOR',ts)),
      ("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,'PRODUCTION_SLOT_QA_APPROVED','FROZEN',?,?)",('E1','P','{}',ts)),
      ("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,'ASSET_PROMOTED_AFTER_QA','APPROVED',?,?)",('E2','P','{}',ts)),
      ("INSERT OR IGNORE INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES (?,?,'ASSET_USAGE_REGISTERED','OK',?,?)",('E3','P','{}',ts)),
      ("UPDATE assets SET use_count=(SELECT COUNT(*) FROM asset_usage WHERE asset_usage.asset_id=assets.id),last_used_at=?,updated_at=? WHERE id IN (?)",(ts,ts,'AST-X')),
      ("WITH changes(slot_id,asset_id) AS (VALUES (?,?)) UPDATE automatic_project_items SET linked_asset_id=(SELECT asset_id FROM changes WHERE changes.slot_id=automatic_project_items.item_key),status='FROZEN',stage='DONE',collection_status='COMPLETE',qa_status='QA_COMPLETE',qa_completed_at=?,updated_at=? WHERE project_id=? AND kind='production_slot_relink' AND item_key IN (SELECT slot_id FROM changes)",('S','AST-X',ts,ts,'P')),
      ("UPDATE v2_download_packages SET status='STALE',error='QA_FINALIZED_REGENERATE_IMAGES',updated_at=? WHERE project_id=? AND type IN ('PROJECT_IMAGES_ZIP','PROJECT_PRODUCTION_ZIP') AND status IN ('READY_FOR_DOWNLOAD','COMPLETED','DOWNLOADED')",(ts,'P')),
      ("UPDATE v2_reference_pools SET status=CASE WHEN EXISTS (SELECT 1 FROM v2_production_slots ps WHERE ps.reference_pool_id=v2_reference_pools.id AND ps.asset_id IS NOT NULL AND ps.status='FROZEN') THEN 'QA_COMPLETE' WHEN EXISTS (SELECT 1 FROM v2_production_slots ps WHERE ps.reference_pool_id=v2_reference_pools.id AND (ps.asset_id IS NOT NULL OR ps.candidate_id IS NOT NULL)) THEN 'READY' ELSE status END,updated_at=? WHERE project_id=? AND version=?",(ts,'P',1)),
    ]
    project_sql="""UPDATE automatic_projects SET status='ACTIVE',pipeline_status=CASE WHEN EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND status='ASSIGNED_FOR_QA') THEN 'QA_REVIEW_WORKING' WHEN EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND status='RELINK_REQUIRED') THEN 'SLOT_ASSIGNMENT_WORKING' WHEN NOT EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND NOT (status='FROZEN' AND asset_id IS NOT NULL)) THEN 'QA_COMPLETE' ELSE 'SLOT_ASSIGNMENT_WORKING' END,next_action=CASE WHEN EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND status='ASSIGNED_FOR_QA') THEN 'FINALIZE_QA_OR_REJECT_SLOTS' WHEN EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND status='RELINK_REQUIRED') THEN 'RELINK_PRODUCTION_SLOTS' WHEN NOT EXISTS(SELECT 1 FROM v2_production_slots WHERE project_id=? AND version=? AND NOT (status='FROZEN' AND asset_id IS NOT NULL)) THEN 'GENERATE_PACKAGE' ELSE 'ASSIGN_ASSETS_TO_SLOTS' END,state_version=state_version+1,workflow_updated_at=?,updated_at=? WHERE id=?"""
    stmts.append((project_sql,('P',1,'P',1,'P',1,'P',1,'P',1,'P',1,ts,ts,'P')))
    c.execute('BEGIN')
    for sql,b in stmts:c.execute(sql,b)
    c.commit()
    return {
      'slot_promoted_and_frozen':c.execute("SELECT asset_id,candidate_id,status,assignment_source FROM v2_production_slots").fetchone()==('AST-X',None,'FROZEN','EXTERNAL_PROMOTED_AFTER_QA'),
      'candidate_promoted':c.execute("SELECT status,asset_id,r2_key FROM v2_ingest_candidates").fetchone()==('APPROVED','AST-X','assets/AST-X/C.jpg'),
      'asset_usage_exactly_once':c.execute("SELECT status,use_count FROM assets WHERE id='AST-X'").fetchone()==('Aprovado',1) and c.execute("SELECT COUNT(*) FROM asset_usage").fetchone()[0]==1,
      'project_advances_after_frozen':c.execute("SELECT pipeline_status,next_action FROM automatic_projects").fetchone()==('QA_COMPLETE','GENERATE_PACKAGE'),
      'history_candidate_provenance':c.execute("SELECT event,previous_candidate_id,new_asset_id FROM v2_production_slot_history WHERE id='H'").fetchone()==('PRODUCTION_SLOT_QA_APPROVED','C','AST-X'),
    }

def rollback_case():
    c=db();before_slot=c.execute("SELECT asset_id,candidate_id,status,updated_at FROM v2_production_slots").fetchone()
    failed=False
    try:
      c.execute('BEGIN')
      c.execute("INSERT INTO automatic_project_events(id,project_id,event,status,detail,created_at) VALUES ('CE','P','PROJECT_QA_FINALIZED','COMMITTED','{}',10)")
      # Stale preflight: expected updated_at=999. NOT EXISTS is true, so the guard
      # tries to write project_id=NULL into a NOT NULL column and aborts the tx.
      c.execute("INSERT INTO v2_production_slot_history(id,project_id,project_version,slot_id,event,created_at) SELECT 'G',NULL,0,'__ATOMIC_QA_GUARD__','ATOMIC_QA_GUARD',10 WHERE NOT EXISTS(SELECT 1 FROM v2_production_slots WHERE id='S' AND status='ASSIGNED_FOR_QA' AND COALESCE(asset_id,'')='' AND COALESCE(candidate_id,'')='C' AND COALESCE(updated_at,0)=999)")
      c.commit()
    except Exception:
      failed=True;c.rollback()
    return {
      'forced_guard_failure':failed,
      'rollback_preserves_slot':c.execute("SELECT asset_id,candidate_id,status,updated_at FROM v2_production_slots").fetchone()==before_slot,
      'rollback_removes_commit_marker':c.execute("SELECT COUNT(*) FROM automatic_project_events WHERE id='CE'").fetchone()[0]==0,
      'rollback_removes_guard_artifact':c.execute("SELECT COUNT(*) FROM v2_production_slot_history").fetchone()[0]==0,
    }

def main():
    checks={**success_case(),**rollback_case()};report={'version':'0.20.45','gate':'exact SQL smoke for finalizar_qa_projeto','checks':checks,'pass':all(checks.values())}
    (ROOT/'SQL_GATE_0_20_45_QA_FINALIZE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['pass'] else 1
if __name__=='__main__':raise SystemExit(main())
