-- CORVO LIBRARY V2 2.19.0 — project slots, lifecycle lock and parallel workflow tags
-- Additive only. Projects remain preserved; completed/rejected projects are MCP-locked until explicit reopen.

ALTER TABLE automatic_projects ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE automatic_projects ADD COLUMN mcp_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_projects ADD COLUMN rejected_at INTEGER;
ALTER TABLE automatic_projects ADD COLUMN closed_reason TEXT;
ALTER TABLE automatic_projects ADD COLUMN workflow_updated_at INTEGER;

ALTER TABLE v2_project_media ADD COLUMN slot_index INTEGER;
ALTER TABLE v2_project_media ADD COLUMN orientation TEXT;
ALTER TABLE v2_project_titles ADD COLUMN slot_index INTEGER;

CREATE TABLE IF NOT EXISTS v2_project_workflow_tags (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id),
  tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  owner_id TEXT,
  execution_id TEXT,
  ttl_seconds INTEGER,
  last_seen_at INTEGER,
  lease_expires_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_workflow_tag_unique ON v2_project_workflow_tags(project_id,tag);
CREATE INDEX IF NOT EXISTS idx_v2_project_workflow_active ON v2_project_workflow_tags(project_id,status,lease_expires_at,updated_at DESC);

UPDATE automatic_projects
SET lifecycle_status=CASE
  WHEN upper(COALESCE(status,'')) IN ('COMPLETED','DONE','CONCLUIDO','CONCLUÍDO') THEN 'COMPLETED'
  WHEN upper(COALESCE(status,'')) IN ('REJECTED','REJEITADO','CANCELLED','CANCELADO') THEN 'REJECTED'
  ELSE 'ACTIVE' END,
    mcp_locked=CASE WHEN upper(COALESCE(status,'')) IN ('COMPLETED','DONE','CONCLUIDO','CONCLUÍDO','REJECTED','REJEITADO','CANCELLED','CANCELADO') THEN 1 ELSE 0 END,
    workflow_updated_at=COALESCE(workflow_updated_at,updated_at);

CREATE INDEX IF NOT EXISTS idx_automatic_projects_lifecycle_updated ON automatic_projects(lifecycle_status,updated_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_media_slot ON v2_project_media(project_id,kind,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('THUMB_REJECTED','REJECTED');
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_project_titles_slot ON v2_project_titles(project_id,slot_index) WHERE slot_index IS NOT NULL AND status NOT IN ('TITLE_REJECTED','REJECTED');

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.19.0',unixepoch('now')*1000);
