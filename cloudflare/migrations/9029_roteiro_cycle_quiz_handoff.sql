-- Roteiro library-first cycle + normalized catalog + QA->Quiz handoff.
-- Additive migration. Text normalization itself is performed in TypeScript;
-- D1 only persists/invalidate the normalized search index.
PRAGMA foreign_keys = ON;

ALTER TABLE automatic_projects ADD COLUMN visual_strategy TEXT;
ALTER TABLE automatic_projects ADD COLUMN cycle_position INTEGER;
ALTER TABLE automatic_projects ADD COLUMN roteiro_cycle_advanced_at INTEGER;
ALTER TABLE automatic_projects ADD COLUMN creation_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_automatic_projects_creation_operation
  ON automatic_projects(creation_operation_id)
  WHERE creation_operation_id IS NOT NULL AND creation_operation_id<>'';
CREATE INDEX IF NOT EXISTS idx_automatic_projects_quiz_render
  ON automatic_projects(updated_at ASC,id ASC)
  WHERE next_action='QUIZ_RENDER' AND COALESCE(lifecycle_status,'ACTIVE')='ACTIVE';

CREATE TABLE IF NOT EXISTS v2_roteiro_cycle_state (
  id TEXT PRIMARY KEY NOT NULL,
  next_position INTEGER NOT NULL DEFAULT 1 CHECK(next_position BETWEEN 1 AND 5),
  reserved_project_id TEXT,
  reserved_operation_id TEXT,
  reserved_at INTEGER,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO v2_roteiro_cycle_state(id,next_position,updated_at)
VALUES ('ROTEIRO',1,unixepoch('now')*1000);

CREATE TABLE IF NOT EXISTS v2_project_quiz_render (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES automatic_projects(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL,
  payload_hash TEXT,
  import_job_id TEXT,
  render_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt INTEGER NOT NULL DEFAULT 0,
  video_url TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_v2_project_quiz_render_status
  ON v2_project_quiz_render(status,updated_at);

CREATE TABLE IF NOT EXISTS v2_asset_search_index (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name_norm TEXT NOT NULL DEFAULT '',
  universe_norm TEXT NOT NULL DEFAULT '',
  subject_norm TEXT NOT NULL DEFAULT '',
  kind_norm TEXT NOT NULL DEFAULT '',
  tags_norm TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- An asset mutation only invalidates the normalized row. The next catalog/search
-- request repairs stale rows with the same normalization function used on inputs.
CREATE TRIGGER IF NOT EXISTS trg_v2_asset_search_insert
AFTER INSERT ON assets BEGIN
  INSERT OR REPLACE INTO v2_asset_search_index(
    asset_id,name_norm,universe_norm,subject_norm,kind_norm,tags_norm,updated_at
  ) VALUES(NEW.id,'','','','','',0);
END;

CREATE TRIGGER IF NOT EXISTS trg_v2_asset_search_update
AFTER UPDATE OF name,universe,subject,kind,tags,updated_at ON assets BEGIN
  INSERT OR REPLACE INTO v2_asset_search_index(
    asset_id,name_norm,universe_norm,subject_norm,kind_norm,tags_norm,updated_at
  ) VALUES(NEW.id,'','','','','',0);
END;

CREATE TRIGGER IF NOT EXISTS trg_v2_asset_search_delete
AFTER DELETE ON assets BEGIN
  DELETE FROM v2_asset_search_index WHERE asset_id=OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_v2_asset_search_universe
  ON v2_asset_search_index(universe_norm,asset_id);
CREATE INDEX IF NOT EXISTS idx_v2_asset_search_kind
  ON v2_asset_search_index(kind_norm,asset_id);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.29.0',unixepoch('now')*1000);
