-- CORVO LIBRARY V2 2.17.0 — schema contract gate / drift reconciliation marker
-- The Worker additionally reconciles missing collector/QA columns by PRAGMA table_info,
-- because SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS and a production D1
-- may have a partially-applied/incorrectly-registered 9016.

CREATE TABLE IF NOT EXISTS v2_schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.17.0',unixepoch('now')*1000);
