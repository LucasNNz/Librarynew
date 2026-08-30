-- CORVO LIBRARY V2 2.21.0 — explicit production model / slot manifest
-- Additive only. Separates reusable reference pools from production scenes and final output slots.

CREATE TABLE IF NOT EXISTS v2_reference_pools (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  pool_key TEXT NOT NULL,
  subject TEXT,
  universe TEXT,
  semantic_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_reference_pool_unique ON v2_reference_pools(project_id,version,pool_key);
CREATE INDEX IF NOT EXISTS idx_v2_reference_pool_status ON v2_reference_pools(project_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_production_scenes (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  scene_key TEXT NOT NULL,
  scene_number INTEGER,
  title TEXT,
  universe TEXT,
  subject TEXT,
  concept TEXT,
  semantic_reference TEXT,
  script_excerpt TEXT,
  preset TEXT,
  context TEXT,
  composition_class TEXT NOT NULL DEFAULT 'CONTEXTUAL',
  status TEXT NOT NULL DEFAULT 'READY',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_scene_unique ON v2_production_scenes(project_id,version,scene_key);
CREATE INDEX IF NOT EXISTS idx_v2_production_scene_status ON v2_production_scenes(project_id,status,scene_number);

CREATE TABLE IF NOT EXISTS v2_production_slots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  scene_id TEXT REFERENCES v2_production_scenes(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL DEFAULT 1,
  target_file TEXT,
  subject TEXT,
  universe TEXT,
  semantic_reference TEXT,
  reference_pool_id TEXT REFERENCES v2_reference_pools(id),
  preset TEXT,
  context TEXT,
  composition_class TEXT NOT NULL DEFAULT 'CONTEXTUAL',
  asset_id TEXT REFERENCES assets(id),
  status TEXT NOT NULL DEFAULT 'UNRESOLVED',
  observation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_slot_key_unique ON v2_production_slots(project_id,version,slot_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_production_target_unique ON v2_production_slots(project_id,version,target_file) WHERE target_file IS NOT NULL AND target_file<>'';
CREATE INDEX IF NOT EXISTS idx_v2_production_slot_status ON v2_production_slots(project_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_production_slot_asset ON v2_production_slots(asset_id,project_id);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.21.0',unixepoch('now')*1000);
