-- CORVO LIBRARY V2 2.15.0 — one-time operational cleanup
-- Preserved intentionally:
--   v2_infrastructure_profiles, v2_infrastructure_config_events
--   v2_migrations_applied and all Worker secrets/bindings (outside D1)
PRAGMA foreign_keys = OFF;

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

DELETE FROM settings;
DELETE FROM collection_sources;
DELETE FROM source_profiles;
DELETE FROM worker_capacity_limits;
DELETE FROM operational_policies;
DELETE FROM semantic_stock_policies;

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
DELETE FROM v2_maintenance_state;

DELETE FROM v2_schema_meta WHERE key NOT IN ('schema_version');
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.15.0',unixepoch('now')*1000);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('operational_clean_release_0_20_8','DONE',unixepoch('now')*1000);

PRAGMA foreign_keys = ON;
