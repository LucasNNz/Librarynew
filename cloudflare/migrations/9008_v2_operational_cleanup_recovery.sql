-- CORVO LIBRARY V2 2.8.0 — operational cleanup + R2 self-describing recovery
-- User decision: legacy projects are not recoverable/useful in the new UI, so their control-plane state is purged once.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS v2_recovery_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_recovery_events_entity ON v2_recovery_events(entity_type,entity_id,created_at DESC);

CREATE TABLE IF NOT EXISTS v2_maintenance_state (
  key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  detail_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

INSERT OR IGNORE INTO v2_maintenance_state(key,status,detail_json,created_at,updated_at)
VALUES ('PURGE_LEGACY_PROJECT_R2','PENDING','{"prefix":"projects/","reason":"historical projects intentionally removed in V2 0.15"}',unixepoch('now')*1000,unixepoch('now')*1000);

-- Remove project-scoped policy/gap state but preserve GLOBAL policies learned by the Supervisor.
DELETE FROM operational_policy_events WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operational_policies WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operational_gaps WHERE project_id IS NOT NULL OR item_id IS NOT NULL;

-- Remove V2 project delivery/control state.
DELETE FROM v2_download_packages;
DELETE FROM v2_project_media;
DELETE FROM v2_project_titles;
DELETE FROM v2_control_jobs WHERE project_id IS NOT NULL;

-- Remove historical project/supervisor/worker state in dependency order.
DELETE FROM plan_branches;
DELETE FROM source_routing_plans;
DELETE FROM supervisor_project_candidates;
DELETE FROM supervisor_decision_queue;
DELETE FROM supervisor_plans;
DELETE FROM supervisor_executions;
DELETE FROM project_runs;
DELETE FROM worker_events WHERE project_id IS NOT NULL;
DELETE FROM worker_sessions WHERE project_id IS NOT NULL;
DELETE FROM worker_work_items WHERE project_id IS NOT NULL;
DELETE FROM supervisor_config_events WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operation_results WHERE project_id IS NOT NULL;
DELETE FROM export_jobs WHERE project_id IS NOT NULL;
DELETE FROM stage_metrics WHERE project_id IS NOT NULL;
DELETE FROM automatic_project_events;
DELETE FROM automatic_project_files;
DELETE FROM automatic_project_items;
DELETE FROM automatic_projects;

-- Do not keep dead visual references to removed project entities on assets.
UPDATE assets SET project_origin=NULL WHERE project_origin IS NOT NULL AND TRIM(project_origin)<>'';

-- Default operational stance: one strong R2 scan, then discard missing metadata and recapture cleanly.
INSERT OR IGNORE INTO operational_policies
(id,policy_key,name,description,category,status,rule_type,scope_level,propagation_level,condition_json,action_json,priority,confidence,created_by,version,notes,created_at,updated_at)
VALUES
('POL-V2-MISSING-R2-RECAPTURE','missing-r2-recapture','Descartar mídia ausente e recaptar','Depois de uma varredura completa do R2, registros sem objeto físico devem ser excluídos e recaptados em vez de entrar em loops de reconciliação.','STORAGE','ACTIVE','LEARNED_POLICY','GLOBAL',10,'{"state":"NOT_FOUND","after_full_r2_scan":true}','{"action":"PERMANENT_DELETE_AND_RECAPTURE","max_reconcile_attempts":1,"preserve_dead_metadata":false}',100,100,'SUPERVISOR_MCP',1,'Supervisor pode editar/substituir esta política livremente via MCP.',unixepoch('now')*1000,unixepoch('now')*1000);

INSERT OR IGNORE INTO operational_policies
(id,policy_key,name,description,category,status,rule_type,scope_level,propagation_level,condition_json,action_json,priority,confidence,created_by,version,notes,created_at,updated_at)
VALUES
('POL-V2-SUPERVISOR-AUTONOMY','supervisor-policy-autonomy','Autonomia de políticas do Supervisor','O Supervisor MCP pode criar, versionar, ativar, suspender e substituir políticas operacionais em qualquer escopo.','SUPERVISOR','ACTIVE','SYSTEM_POLICY','GLOBAL',10,'{}','{"allow_policy_authoring":true,"allow_global_scope":true,"allow_activation":true,"allow_rollback":true,"allow_replacement":true}',100,100,'SUPERVISOR_MCP',1,'Regra estrutural da V2: políticas não ficam engessadas no frontend.',unixepoch('now')*1000,unixepoch('now')*1000);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.8.0',unixepoch('now') * 1000);

PRAGMA foreign_keys = ON;
