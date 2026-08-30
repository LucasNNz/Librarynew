-- CORVO LIBRARY V2 2.23.0 — persistent visual tags per slot
CREATE TABLE IF NOT EXISTS v2_slot_tags (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  emoji TEXT NOT NULL,
  label TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  removed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_slot_tags_unique ON v2_slot_tags(project_id,slot_id,tag_key);
CREATE INDEX IF NOT EXISTS idx_v2_slot_tags_active ON v2_slot_tags(project_id,active,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_slot_tags_key ON v2_slot_tags(tag_key,active,updated_at DESC);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at) VALUES ('schema_version','2.23.0',unixepoch('now')*1000);
