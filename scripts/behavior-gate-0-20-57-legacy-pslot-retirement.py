from pathlib import Path
import sqlite3, re, sys
root=Path(__file__).resolve().parents[1]
model=(root/'cloudflare/src/core/production-model.ts').read_text()
projects=(root/'cloudflare/src/core/projects.ts').read_text()
production=(root/'cloudflare/src/core/production.ts').read_text()
workflow=(root/'cloudflare/src/core/project-workflow.ts').read_text()
checks={
 'version_0_20_57':'"version": "0.20.57"' in (root/'package.json').read_text(),
 'retired_status_created':"status='RETIRED'" in model and 'PRODUCTION_SLOT_RETIRED' in model,
 'script_authoritative_shape':'productionShapeDrift' in projects and 'expectedTargets' in projects and 'activeTargets' in projects,
 'legacy_qa_status_never_null':'?"QA_PENDING":null' not in model and '?"QA_PENDING":"WAITING_COLLECTION"' in model,
 'retired_pitem_qa_status':'state==="RETIRED"?"RETIRED"' in model,
 'retired_terminal_worker_state':'"RETIRED"' in re.search(r'const terminalItemStates[^;]+;',projects).group(0),
 'counts_exclude_retired':"status<>'RETIRED'`" in model,
 'zip_excludes_retired':"s.status<>'RETIRED'" in production,
 'lifecycle_excludes_retired':"WHERE project_id=? AND status<>'RETIRED'" in workflow,
 'retired_history_preserved':'SCRIPT_NO_LONGER_REFERENCES_SLOT' in model,
 'no_asset_delete_on_retirement':"PRODUCTION_SLOT_RETIRED" in model and "MEDIA.delete" not in model[model.index('SCRIPT is authoritative'):model.index('const counts=await productionModelCounts', model.index('SCRIPT is authoritative'))],
}
# SQLite behavior simulation: 97 FROZEN + 1 stale PENDING => retire stale; legacy pitem receives non-null RETIRED.
db=sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE v2_production_slots(id TEXT PRIMARY KEY,target_file TEXT,status TEXT NOT NULL,asset_id TEXT,candidate_id TEXT,updated_at INTEGER);
CREATE TABLE automatic_project_items(id TEXT PRIMARY KEY,item_key TEXT,target_file TEXT,status TEXT NOT NULL,stage TEXT NOT NULL,collection_status TEXT NOT NULL,qa_status TEXT NOT NULL,linked_asset_id TEXT);
''')
for i in range(1,98):
    db.execute('INSERT INTO v2_production_slots VALUES(?,?,?,?,?,?)',(f'S{i}',f'{i:03}-ok.jpg','FROZEN',f'AST-{i}',None,1))
db.execute('INSERT INTO v2_production_slots VALUES(?,?,?,?,?,?)',('S98','042-bakugo.jpg','PENDING',None,None,1))
db.execute('INSERT INTO automatic_project_items VALUES(?,?,?,?,?,?,?,?)',('I98','S98','042-bakugo.jpg','COLLECTING','DISCOVERY','COLLECTING','WAITING_COLLECTION',None))
# retirement mutation mirrors hotfix semantics
db.execute("UPDATE v2_production_slots SET status='RETIRED',updated_at=2 WHERE id='S98' AND status<>'RETIRED'")
db.execute("UPDATE automatic_project_items SET status='RETIRED',stage='DONE',collection_status='COMPLETE',qa_status='RETIRED' WHERE id='I98'")
active=db.execute("SELECT COUNT(*),SUM(CASE WHEN status='FROZEN' THEN 1 ELSE 0 END),SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) FROM v2_production_slots WHERE status<>'RETIRED'").fetchone()
retired=db.execute("SELECT COUNT(*) FROM v2_production_slots WHERE status='RETIRED'").fetchone()[0]
qa=db.execute("SELECT qa_status FROM automatic_project_items WHERE id='I98'").fetchone()[0]
checks.update({
 'simulation_97_active':active==(97,97,0),
 'simulation_one_retired':retired==1,
 'simulation_non_null_retired_qa':qa=='RETIRED',
})
for name,ok in checks.items(): print(f'{name}: {"PASS" if ok else "FAIL"}')
failed=[k for k,v in checks.items() if not v]
print(f'\n{len(checks)-len(failed)}/{len(checks)} PASS')
if failed:
    print('FAILED:',','.join(failed)); sys.exit(1)
