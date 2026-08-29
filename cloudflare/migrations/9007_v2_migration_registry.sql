-- CORVO LIBRARY V2 — web-managed migration registry
-- Enables future updates without CLI/local installation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v2_migrations_applied (
  name TEXT PRIMARY KEY NOT NULL,
  checksum TEXT NOT NULL DEFAULT '',
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO v2_migrations_applied (name,checksum,applied_at) VALUES
  ('9000_v2_core.sql','bootstrap',unixepoch('now') * 1000),
  ('9001_v2_observability.sql','bootstrap',unixepoch('now') * 1000),
  ('9002_v2_direct_upload.sql','bootstrap',unixepoch('now') * 1000),
  ('9003_v2_control_plane.sql','bootstrap',unixepoch('now') * 1000),
  ('9004_v2_archives.sql','bootstrap',unixepoch('now') * 1000),
  ('9005_v2_delivery_hardening.sql','bootstrap',unixepoch('now') * 1000),
  ('9006_v2_persistent_infrastructure.sql','bootstrap',unixepoch('now') * 1000),
  ('9007_v2_migration_registry.sql','bootstrap',unixepoch('now') * 1000);

INSERT OR REPLACE INTO v2_schema_meta (key,value,updated_at)
VALUES ('schema_version','2.7.0',unixepoch('now') * 1000);
