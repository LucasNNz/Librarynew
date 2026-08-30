-- CORVO LIBRARY V2 0.16 — explicit MCP/runtime heartbeats
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_runtime_heartbeats (
  id TEXT PRIMARY KEY NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  ttl_seconds INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_scope ON v2_runtime_heartbeats(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_status_expiry ON v2_runtime_heartbeats(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_owner_execution ON v2_runtime_heartbeats(owner_id, execution_id, updated_at DESC);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.9.0',unixepoch('now') * 1000);
