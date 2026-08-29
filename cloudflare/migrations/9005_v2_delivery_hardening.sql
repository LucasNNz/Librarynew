-- CORVO LIBRARY V2 — direct delivery hardening
-- Atomic upload/confirm claims + observable retry state.
PRAGMA foreign_keys = ON;

ALTER TABLE v2_direct_uploads ADD COLUMN upload_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_direct_uploads ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE v2_direct_uploads ADD COLUMN failure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_direct_uploads_status_updated ON v2_direct_uploads(status, updated_at);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.5.0',unixepoch('now') * 1000);
