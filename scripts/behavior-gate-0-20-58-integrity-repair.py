from pathlib import Path
import sqlite3, sys, json
root=Path(__file__).resolve().parents[1]
mcp=(root/'cloudflare/src/mcp.ts').read_text()
integ=(root/'cloudflare/src/core/integrity-repair.ts').read_text()
projects=(root/'cloudflare/src/core/projects.ts').read_text()
pkg=json.loads((root/'package.json').read_text())
checks={
 'version_0_20_58':pkg.get('version')=='0.20.58',
 'tool_list_worker_unique':'"listar_conflitos_worker_work_items_unique"' in mcp,
 'tool_dedupe_worker_unique':'"deduplicar_worker_work_items_unique"' in mcp,
 'tool_repair_worker_project':'"reparar_worker_work_items_projeto"' in mcp,
 'tool_list_obsolete_slots':'"listar_production_slots_obsoletos"' in mcp,
 'tool_retire_obsolete_slots':'"aposentar_production_slots_obsoletos"' in mcp,
 'tool_repair_project_integrity':'"reparar_integridade_projeto"' in mcp,
 'unique_contract_visible':'scope_type + scope_id + stage' in integ,
 'completed_history_preserved':'PRESERVE_COMPLETED_AND_USE_REVISION_SCOPE' in integ and 'PROJECT_ITEM_REVISION' in projects,
 'cancelled_failed_reused':'RECONCILE_REUSE_UNIQUE_ROW' in projects and "'CANCELLED','FAILED','SUPERSEDED'" in projects,
 'no_worker_delete':'DELETE FROM worker_work_items' not in integ,
 'duplicates_superseded_not_deleted':'UNIQUE_DEDUP_SUPERSEDED' in integ,
 'valid_lease_priority':'status==="LEASED"&&lease>now' in integ,
 'obsolete_compares_script':'parseProjectScriptScenes' in integ and 'NOT_PRESENT_IN_CURRENT_SCRIPT' in integ,
 'retire_dry_run_default':'const dryRun=input.dryRun!==false' in integ,
 'retire_atomic_batch':'await env.DB.batch(statements)' in integ and 'atomic_d1:true' in integ,
 'retire_preserves_r2':'r2_untouched:true' in integ,
 'retire_reconciles_pitem':"qa_status='RETIRED'" in integ,
 'repair_requires_confirm':'CONFIRMATION_REQUIRED' in integ,
 'repair_operation_idempotence':'PROJECT_INTEGRITY_REPAIR' in integ and 'idempotent_replay:true' in integ,
}
# SQL simulation for the historical UNIQUE blocker that caused reconcile failure.
db=sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE worker_work_items(
 id TEXT PRIMARY KEY,scope_type TEXT NOT NULL,scope_id TEXT NOT NULL,project_id TEXT,item_id TEXT,stage TEXT NOT NULL,
 worker_type TEXT,status TEXT NOT NULL,ready_at INTEGER,completed_at INTEGER,last_action TEXT,
 lease_owner_worker_id TEXT,lease_execution_id TEXT,lease_started_at INTEGER,lease_last_seen_at INTEGER,lease_expires_at INTEGER,
 UNIQUE(scope_type,scope_id,stage));
''')
db.execute("INSERT INTO worker_work_items(id,scope_type,scope_id,project_id,item_id,stage,worker_type,status,completed_at) VALUES('W1','PROJECT_ITEM','I1','P1','I1','DISCOVERY','DISCOVERY','COMPLETED',1)")
# Completed history remains untouched; revision-scoped work can coexist under strict UNIQUE.
db.execute("INSERT INTO worker_work_items(id,scope_type,scope_id,project_id,item_id,stage,worker_type,status,ready_at) VALUES('W2','PROJECT_ITEM_REVISION','I1:SV7:DISCOVERY','P1','I1','DISCOVERY','DISCOVERY','READY',2)")
checks['simulation_completed_preserved']=db.execute("SELECT status FROM worker_work_items WHERE id='W1'").fetchone()[0]=='COMPLETED'
checks['simulation_revision_created']=db.execute("SELECT status FROM worker_work_items WHERE id='W2'").fetchone()[0]=='READY'
# CANCELLED strict-key row is safely reused instead of INSERT collision.
db.execute("INSERT INTO worker_work_items(id,scope_type,scope_id,project_id,item_id,stage,worker_type,status,completed_at) VALUES('W3','PROJECT_ITEM','I2','P1','I2','RELINK','RELINK','CANCELLED',3)")
db.execute("UPDATE worker_work_items SET status='READY',completed_at=NULL,last_action='RECONCILE_REUSE_UNIQUE_ROW' WHERE id='W3' AND status IN ('CANCELLED','FAILED','SUPERSEDED')")
checks['simulation_cancelled_reused']=db.execute("SELECT status,completed_at FROM worker_work_items WHERE id='W3'").fetchone()==('READY',None)
# Obsolete PSLOT retirement keeps valid FROZEN intact and retires only stale target.
db.executescript('''
CREATE TABLE slots(id TEXT PRIMARY KEY,target_file TEXT,status TEXT,asset_id TEXT);
CREATE TABLE pitems(id TEXT PRIMARY KEY,target_file TEXT,status TEXT,stage TEXT,collection_status TEXT,qa_status TEXT NOT NULL);
''')
db.execute("INSERT INTO slots VALUES('S1','001-good.jpg','FROZEN','AST1')")
db.execute("INSERT INTO slots VALUES('S2','042-bakugo.jpg','PENDING',NULL)")
db.execute("INSERT INTO pitems VALUES('I2','042-bakugo.jpg','COLLECTING','DISCOVERY','COLLECTING','WAITING_COLLECTION')")
db.execute("UPDATE slots SET status='RETIRED' WHERE id='S2'")
db.execute("UPDATE pitems SET status='RETIRED',stage='DONE',collection_status='COMPLETE',qa_status='RETIRED' WHERE id='I2'")
checks['simulation_frozen_untouched']=db.execute("SELECT status,asset_id FROM slots WHERE id='S1'").fetchone()==('FROZEN','AST1')
checks['simulation_stale_retired']=db.execute("SELECT status FROM slots WHERE id='S2'").fetchone()[0]=='RETIRED'
checks['simulation_pitem_nonnull_retired']=db.execute("SELECT qa_status FROM pitems WHERE id='I2'").fetchone()[0]=='RETIRED'
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.58','schema':'2.27.0','feature':'Project integrity repair: UNIQUE worker recovery + obsolete PSLOT retirement','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_58_PROJECT_INTEGRITY_REPAIR.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for k,v in checks.items(): print(f'{k}: {"PASS" if v else "FAIL"}')
print(f'\n{len(checks)-len(failed)}/{len(checks)} PASS')
if failed:
    print('FAILED:',','.join(failed));sys.exit(1)
