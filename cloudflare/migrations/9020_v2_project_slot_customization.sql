-- CORVO LIBRARY V2 2.20.0 — project slot customization / MCP-open slots
CREATE TABLE IF NOT EXISTS v2_project_slot_access (
  project_id TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  mcp_open INTEGER NOT NULL DEFAULT 0,
  instruction TEXT,
  opened_by TEXT,
  opened_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, slot_key),
  FOREIGN KEY (project_id) REFERENCES automatic_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_project_slot_access_open
  ON v2_project_slot_access(mcp_open, updated_at DESC);


INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.20.0',unixepoch('now')*1000);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.20.0',unixepoch('now')*1000);
