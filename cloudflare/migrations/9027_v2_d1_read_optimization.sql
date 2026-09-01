-- CORVO LIBRARY V2 2.27.0 — D1 read optimization + route telemetry
-- Additive/index-only for operational tables. No project/assets are deleted.

CREATE TABLE IF NOT EXISTS v2_mcp_route_telemetry (
  id TEXT PRIMARY KEY NOT NULL,
  tool TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  db_query_count INTEGER NOT NULL DEFAULT 0,
  meta_covered_queries INTEGER NOT NULL DEFAULT 0,
  rows_read_observed INTEGER NOT NULL DEFAULT 0,
  rows_written_observed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_mcp_route_telemetry_created
ON v2_mcp_route_telemetry(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_mcp_route_telemetry_tool_created
ON v2_mcp_route_telemetry(tool,created_at DESC);

ALTER TABLE automatic_projects ADD COLUMN production_reconciled_at INTEGER;

-- Agent/control-plane hot paths.
CREATE INDEX IF NOT EXISTS idx_automatic_projects_actionable
ON automatic_projects(queue_priority DESC,updated_at ASC,id ASC)
WHERE COALESCE(lifecycle_status,'ACTIVE')='ACTIVE' AND next_action IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_items_project_status
ON automatic_project_items(project_id,status,priority DESC,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_items_project_priority
ON automatic_project_items(project_id,priority DESC,created_at ASC);
CREATE INDEX IF NOT EXISTS idx_project_files_project_role
ON automatic_project_files(project_id,role,version DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_events_project_created
ON automatic_project_events(project_id,created_at DESC);

-- Queue claim + reconciliation hot paths. Partial READY index keeps the hot index small.
CREATE INDEX IF NOT EXISTS idx_worker_ready_claim
ON worker_work_items(worker_type,project_domain,resume_priority DESC,priority DESC,original_ready_at ASC,ready_at ASC)
WHERE status='READY';
CREATE INDEX IF NOT EXISTS idx_worker_project_item_active
ON worker_work_items(project_id,item_id,status,worker_type,stage);
CREATE INDEX IF NOT EXISTS idx_worker_project_status
ON worker_work_items(project_id,status,worker_type,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_lease_expiry
ON worker_work_items(status,lease_expires_at)
WHERE status='LEASED';
CREATE INDEX IF NOT EXISTS idx_worker_status_type_domain
ON worker_work_items(status,worker_type,project_domain);
CREATE INDEX IF NOT EXISTS idx_worker_sessions_status_type_domain
ON worker_sessions(status,worker_type,worker_domain);

-- Detail-read covering paths used only after the control plane selects a project.
CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_status
ON v2_ingest_candidates(project_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_project_slot_access_project
ON v2_project_slot_access(project_id,slot_key);
CREATE INDEX IF NOT EXISTS idx_operational_policies_active_scope
ON operational_policies(rule_type,status,scope_level,project_id,preset,priority DESC,updated_at DESC);

-- Production/QA/tag hot paths.
CREATE INDEX IF NOT EXISTS idx_v2_production_slot_project_version_status
ON v2_production_slots(project_id,version,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_production_slot_reference_pool
ON v2_production_slots(reference_pool_id,status);
CREATE INDEX IF NOT EXISTS idx_v2_project_workflow_tag_lookup
ON v2_project_workflow_tags(project_id,status,tag,lease_expires_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_slot_tags_project_key_active
ON v2_slot_tags(project_id,tag_key,active,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_project_media_lookup
ON v2_project_media(project_id,kind,status,selected,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_project_titles_lookup
ON v2_project_titles(project_id,status,slot_index,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_download_packages_project_type_status
ON v2_download_packages(project_id,type,status,created_at DESC);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.27.0',unixepoch('now')*1000);
