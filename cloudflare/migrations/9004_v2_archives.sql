-- CORVO LIBRARY V2 — reusable asset archives
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS v2_asset_exports (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  asset_set_hash TEXT NOT NULL,
  asset_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  r2_key TEXT,
  file_name TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ready_at INTEGER,
  expires_reuse_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_v2_asset_exports_hash ON v2_asset_exports(asset_set_hash,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_asset_exports_operation ON v2_asset_exports(operation_id);
INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at) VALUES ('schema_version','2.4.0',unixepoch('now') * 1000);
