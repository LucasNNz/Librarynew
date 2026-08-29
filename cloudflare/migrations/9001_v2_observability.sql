-- CORVO LIBRARY V2 — observability / durable ingest events
-- Safe additive migration. Historical tables remain untouched.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_ingest_events (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL REFERENCES v2_ingest_operations(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES v2_ingest_candidates(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  status TEXT,
  detail TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ingest_events_operation_created ON v2_ingest_events(operation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_ingest_events_candidate_created ON v2_ingest_events(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_storage_audits (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  total_references INTEGER NOT NULL DEFAULT 0,
  distinct_references INTEGER NOT NULL DEFAULT 0,
  r2_objects INTEGER NOT NULL DEFAULT 0,
  present_references INTEGER NOT NULL DEFAULT 0,
  missing_references INTEGER NOT NULL DEFAULT 0,
  orphan_objects INTEGER NOT NULL DEFAULT 0,
  shared_keys INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_v2_storage_audits_created ON v2_storage_audits(created_at DESC);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.1.0',unixepoch('now') * 1000);
