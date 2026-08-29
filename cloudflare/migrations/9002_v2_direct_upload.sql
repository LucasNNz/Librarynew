-- CORVO LIBRARY V2 — direct upload tickets
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_direct_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  upload_type TEXT NOT NULL DEFAULT 'CANDIDATE',
  status TEXT NOT NULL DEFAULT 'PREPARED',
  project_id TEXT,
  item_id TEXT,
  universe TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  role TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  file_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  expected_mime TEXT,
  actual_mime TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  max_bytes INTEGER NOT NULL DEFAULT 31457280,
  expires_at INTEGER NOT NULL,
  candidate_id TEXT,
  project_file_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_v2_direct_uploads_status_expiry ON v2_direct_uploads(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_v2_direct_uploads_project ON v2_direct_uploads(project_id, updated_at DESC);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.2.0',unixepoch('now') * 1000);
