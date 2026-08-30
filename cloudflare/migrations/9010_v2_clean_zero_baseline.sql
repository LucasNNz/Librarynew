-- CORVO LIBRARY V2 2.10.0 — clean-zero baseline
-- Explicit user decision: remove every recovered/catalog/operational record and start the library from zero.
-- Configuration definitions and infrastructure connection state are preserved.
PRAGMA foreign_keys = OFF;

-- Historical catalog / usage / projects / execution / collection / audit data.
DELETE FROM asset_consultations;
DELETE FROM asset_usage;
DELETE FROM batch_assets;
DELETE FROM assets;
DELETE FROM automatic_project_events;
DELETE FROM automatic_project_files;
DELETE FROM automatic_project_items;
DELETE FROM automatic_projects;
DELETE FROM batches;
DELETE FROM collection_batches;
DELETE FROM collection_candidates;
DELETE FROM collection_source_runs;
DELETE FROM collection_terms;
DELETE FROM export_jobs;
DELETE FROM imports;
DELETE FROM materialization_batches;
DELETE FROM materialization_candidates;
DELETE FROM materialization_files;
DELETE FROM materialization_host_health;
DELETE FROM materialization_host_probes;
DELETE FROM materialization_items;
DELETE FROM materialization_logs;
DELETE FROM mcp_audit;
DELETE FROM operation_results;
DELETE FROM operational_gaps;
DELETE FROM operational_policy_events;
DELETE FROM plan_branches;
DELETE FROM project_runs;
DELETE FROM queue_snapshots;
DELETE FROM requests;
DELETE FROM source_route_metrics;
DELETE FROM source_routing_plans;
DELETE FROM stage_metrics;
DELETE FROM supervisor_config_events;
DELETE FROM supervisor_decision_queue;
DELETE FROM supervisor_executions;
DELETE FROM supervisor_plans;
DELETE FROM supervisor_project_candidates;
DELETE FROM worker_events;
DELETE FROM worker_sessions;
DELETE FROM worker_work_items;

-- V2 runtime state. Do NOT delete v2_infrastructure_profiles or v2_infrastructure_config_events.
DELETE FROM v2_ingest_candidates;
DELETE FROM v2_ingest_events;
DELETE FROM v2_ingest_operations;
DELETE FROM v2_storage_audits;
DELETE FROM v2_direct_uploads;
DELETE FROM v2_control_jobs;
DELETE FROM v2_download_packages;
DELETE FROM v2_project_media;
DELETE FROM v2_project_titles;
DELETE FROM v2_collection_events;
DELETE FROM v2_asset_exports;
DELETE FROM v2_recovery_events;
DELETE FROM v2_runtime_heartbeats;

-- Preserve configuration rows, but remove historical performance counters from them.
UPDATE collection_sources
SET query_count=0,found_count=0,unique_count=0,materialized_count=0,failure_count=0,total_duration_ms=0;

UPDATE source_profiles
SET technical_success_rate=0,visual_approval_rate=0,avg_time_ms=0,
    technical_successes=0,technical_failures=0,visual_approvals=0,visual_rejections=0;

UPDATE operational_policies
SET times_matched=0,times_applied=0,success_count=0,failure_count=0,
    avg_time_before_ms=0,avg_time_after_ms=0,
    approval_rate_before=0,approval_rate_after=0,cost_before=0,cost_after=0,
    last_applied_at=NULL,last_result=NULL;

-- The user already emptied the physical R2 bucket manually.
-- Clear stale maintenance jobs so this migration NEVER deletes anything from the shared bucket.
DELETE FROM v2_maintenance_state;
INSERT INTO v2_maintenance_state(key,status,detail_json,attempts,created_at,updated_at,completed_at)
VALUES (
  'CLEAN_ZERO_BASELINE',
  'DONE',
  '{"r2_action":"NONE","reason":"bucket already empty; D1 recovered data cleared; configuration preserved"}',
  0,
  unixepoch('now')*1000,
  unixepoch('now')*1000,
  unixepoch('now')*1000
);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.10.0',unixepoch('now')*1000);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('data_baseline','CLEAN_ZERO',unixepoch('now')*1000);

PRAGMA foreign_keys = ON;
