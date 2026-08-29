-- CORVO LIBRARY V2 EXTENSIONS
-- Apply only AFTER restoring the historical Corvo D1 schema/data.
-- Existing historical tables are intentionally untouched.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.0.0',unixepoch('now') * 1000);

CREATE TABLE IF NOT EXISTS v2_ingest_operations (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  requested INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ingest_operations_status_updated ON v2_ingest_operations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_ingest_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL REFERENCES v2_ingest_operations(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  project_id TEXT,
  item_id TEXT,
  universe TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  r2_key TEXT,
  asset_id TEXT REFERENCES assets(id),
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_operation ON v2_ingest_candidates(operation_id, status);
CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_status_updated ON v2_ingest_candidates(status, updated_at DESC);
