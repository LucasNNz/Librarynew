-- CORVO LIBRARY V2 2.18.0 — safe live migration executor support
-- Additive only. Recreates structural objects that historically lived inside
-- one-shot cleanup migrations, without replaying any DELETE or R2 purge intent.

CREATE TABLE IF NOT EXISTS v2_recovery_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_recovery_events_entity
ON v2_recovery_events(entity_type,entity_id,created_at DESC);

CREATE TABLE IF NOT EXISTS v2_maintenance_state (
  key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  detail_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS v2_migration_decisions (
  name TEXT PRIMARY KEY NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  checksum TEXT NOT NULL DEFAULT '',
  decided_at INTEGER NOT NULL
);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_scope
ON v2_runtime_heartbeats(scope_type,scope_id);
CREATE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_status_expiry
ON v2_runtime_heartbeats(status,lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_v2_runtime_heartbeats_owner_execution
ON v2_runtime_heartbeats(owner_id,execution_id,updated_at DESC);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('migration_executor_policy','SAFE_LIVE_V1',unixepoch('now')*1000);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.18.0',unixepoch('now')*1000);
