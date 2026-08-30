-- CORVO LIBRARY V2 2.11.0 — explicit purge of every current project
-- User decision: start project space from zero while preserving the asset library and infrastructure configuration.
PRAGMA foreign_keys = OFF;

-- Remove runtime heartbeats that belong to projects/workers before their parent rows disappear.
DELETE FROM v2_runtime_heartbeats
WHERE (scope_type='SUPERVISOR' AND scope_id IN (SELECT id FROM automatic_projects))
   OR (scope_type='WORKER' AND scope_id IN (SELECT id FROM worker_work_items WHERE project_id IS NOT NULL));

-- Remove operation-scoped traces for operations known to belong to projects.
DELETE FROM v2_runtime_heartbeats
WHERE scope_type='OPERATION' AND scope_id IN (
  SELECT operation_id FROM v2_control_jobs WHERE project_id IS NOT NULL
  UNION SELECT operation_id FROM v2_download_packages
  UNION SELECT operation_id FROM v2_ingest_candidates WHERE project_id IS NOT NULL
);
DELETE FROM v2_ingest_events
WHERE operation_id IN (
  SELECT operation_id FROM v2_control_jobs WHERE project_id IS NOT NULL
  UNION SELECT operation_id FROM v2_download_packages
  UNION SELECT operation_id FROM v2_ingest_candidates WHERE project_id IS NOT NULL
);
DELETE FROM v2_ingest_operations
WHERE id IN (
  SELECT operation_id FROM v2_control_jobs WHERE project_id IS NOT NULL
  UNION SELECT operation_id FROM v2_download_packages
  UNION SELECT operation_id FROM v2_ingest_candidates WHERE project_id IS NOT NULL
);

-- Remove project-scoped policy, supervisor and worker state while preserving GLOBAL policies/configuration.
DELETE FROM operational_policy_events WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operational_policies WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operational_gaps WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM supervisor_config_events WHERE project_id IS NOT NULL OR item_id IS NOT NULL;
DELETE FROM operation_results WHERE project_id IS NOT NULL;
DELETE FROM export_jobs WHERE project_id IS NOT NULL;
DELETE FROM stage_metrics WHERE project_id IS NOT NULL;

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

-- Remove V2 project control/delivery state.
DELETE FROM v2_ingest_candidates WHERE project_id IS NOT NULL;
DELETE FROM v2_direct_uploads WHERE project_id IS NOT NULL;
DELETE FROM v2_download_packages;
DELETE FROM v2_project_media;
DELETE FROM v2_project_titles;
DELETE FROM v2_control_jobs WHERE project_id IS NOT NULL;

-- Remove the project graph itself.
DELETE FROM automatic_project_events;
DELETE FROM automatic_project_files;
DELETE FROM automatic_project_items;
DELETE FROM automatic_projects;

-- Assets remain in the Library, but no longer point visually to deleted projects.
UPDATE assets SET project_origin=NULL WHERE project_origin IS NOT NULL AND TRIM(project_origin)<>'';

-- Purge only project artifacts from the shared R2 bucket. Never touch assets/, imports/, recovery/ or any other prefix.
INSERT OR REPLACE INTO v2_maintenance_state
(key,status,detail_json,attempts,created_at,updated_at,completed_at)
VALUES (
  'PURGE_PROJECTS_R2_0_21',
  'PENDING',
  '{"prefixes":["projects/"],"preserve":["assets/","imports/","recovery/"],"reason":"all current projects intentionally removed; asset library preserved"}',
  0,
  unixepoch('now')*1000,
  unixepoch('now')*1000,
  NULL
);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.11.0',unixepoch('now')*1000);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('projects_baseline','CLEAN_ZERO',unixepoch('now')*1000);

PRAGMA foreign_keys = ON;
