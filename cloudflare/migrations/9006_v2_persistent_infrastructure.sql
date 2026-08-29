-- CORVO LIBRARY V2 — persistent infrastructure manifest
-- Non-secret metadata only. This migration never seeds, resets or overwrites configuration.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_infrastructure_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  instance_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  lock_state TEXT NOT NULL DEFAULT 'LOCKED' CHECK(lock_state IN ('LOCKED')),
  bff_project_name TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  d1_database_name TEXT NOT NULL,
  r2_bucket_name TEXT NOT NULL,
  queue_name TEXT NOT NULL,
  dlq_name TEXT NOT NULL,
  configured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_verified_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS v2_infrastructure_config_events (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES v2_infrastructure_profiles(id),
  event_type TEXT NOT NULL,
  previous_revision INTEGER,
  next_revision INTEGER NOT NULL,
  previous_json TEXT,
  next_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'SETUP_WIZARD',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_infrastructure_events_profile_created
ON v2_infrastructure_config_events(profile_id, created_at DESC);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.6.0',unixepoch('now') * 1000);
