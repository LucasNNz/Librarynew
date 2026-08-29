-- CORVO LIBRARY V2 — control plane / production delivery
-- Additive only: historical tables remain untouched.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_control_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_control_jobs_operation_kind ON v2_control_jobs(operation_id,kind);
CREATE INDEX IF NOT EXISTS idx_v2_control_jobs_status_created ON v2_control_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS idx_v2_control_jobs_project_updated ON v2_control_jobs(project_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_download_packages (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id),
  project_revision INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'FULL_PROJECT_ZIP',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  r2_key TEXT,
  file_name TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  error TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  machine_name TEXT,
  sha256_verified INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ready_at INTEGER,
  downloaded_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_download_packages_operation ON v2_download_packages(operation_id);
CREATE INDEX IF NOT EXISTS idx_v2_download_packages_project_revision ON v2_download_packages(project_id,project_revision,type);
CREATE INDEX IF NOT EXISTS idx_v2_download_packages_status_created ON v2_download_packages(status,created_at);

CREATE TABLE IF NOT EXISTS v2_project_media (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id),
  kind TEXT NOT NULL DEFAULT 'THUMB',
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  agent_origin TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_project_media_project_kind ON v2_project_media(project_id,kind,status,created_at);

CREATE TABLE IF NOT EXISTS v2_project_titles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'TITLE_CANDIDATE',
  selected INTEGER NOT NULL DEFAULT 0,
  agent_origin TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_project_titles_project ON v2_project_titles(project_id,status,created_at);

CREATE TABLE IF NOT EXISTS v2_collection_events (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  term_id TEXT,
  source_id TEXT,
  event TEXT NOT NULL,
  status TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_collection_events_batch_created ON v2_collection_events(batch_id,created_at DESC);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.3.0',unixepoch('now') * 1000);
