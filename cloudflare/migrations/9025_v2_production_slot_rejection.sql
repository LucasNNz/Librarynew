-- Corvo Library V2 — production-slot rejection/relink history
-- Schema 2.25.0

ALTER TABLE v2_production_slots ADD COLUMN previous_asset_id TEXT REFERENCES assets(id);
ALTER TABLE v2_production_slots ADD COLUMN relink_required_at INTEGER;
ALTER TABLE v2_production_slots ADD COLUMN relink_reason TEXT;
ALTER TABLE v2_production_slots ADD COLUMN rejected_by TEXT;
ALTER TABLE v2_production_slots ADD COLUMN rejected_operation_id TEXT;

CREATE TABLE IF NOT EXISTS v2_production_slot_history (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  project_version INTEGER NOT NULL DEFAULT 1,
  slot_id TEXT NOT NULL REFERENCES v2_production_slots(id) ON DELETE CASCADE,
  target_file TEXT,
  event TEXT NOT NULL,
  previous_asset_id TEXT REFERENCES assets(id),
  new_asset_id TEXT REFERENCES assets(id),
  reason TEXT,
  operation_id TEXT,
  actor TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_pslot_history_operation
  ON v2_production_slot_history(project_id,slot_id,event,operation_id)
  WHERE operation_id IS NOT NULL AND operation_id<>'';
CREATE INDEX IF NOT EXISTS idx_v2_pslot_history_slot
  ON v2_production_slot_history(project_id,slot_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_pslot_relink_required
  ON v2_production_slots(project_id,status,updated_at DESC)
  WHERE status='RELINK_REQUIRED';

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.25.0',unixepoch('now')*1000);
