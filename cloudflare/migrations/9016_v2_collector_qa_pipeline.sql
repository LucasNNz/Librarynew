-- CORVO LIBRARY V2 2.16.0 — collector -> materialization -> QA state machine
-- Additive only. Preserves historical/project data while making scene state explicit.

ALTER TABLE automatic_project_items ADD COLUMN target_candidates INTEGER NOT NULL DEFAULT 8;
ALTER TABLE automatic_project_items ADD COLUMN required_approved INTEGER NOT NULL DEFAULT 1;
ALTER TABLE automatic_project_items ADD COLUMN discovered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN queued_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN downloading_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN materialized_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN approved_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN rejected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automatic_project_items ADD COLUMN collection_status TEXT NOT NULL DEFAULT 'EMPTY';
ALTER TABLE automatic_project_items ADD COLUMN qa_status TEXT NOT NULL DEFAULT 'WAITING_COLLECTION';
ALTER TABLE automatic_project_items ADD COLUMN qa_ready_at INTEGER;
ALTER TABLE automatic_project_items ADD COLUMN qa_started_at INTEGER;
ALTER TABLE automatic_project_items ADD COLUMN qa_completed_at INTEGER;

ALTER TABLE v2_ingest_candidates ADD COLUMN discovered_at INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN queued_at INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN download_started_at INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN materialized_at INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN queue_wait_ms INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN download_ms INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN r2_write_ms INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN d1_finalize_ms INTEGER;
ALTER TABLE v2_ingest_candidates ADD COLUMN total_materialization_ms INTEGER;

UPDATE v2_ingest_candidates
SET discovered_at=COALESCE(discovered_at,created_at),
    queued_at=COALESCE(queued_at,created_at),
    materialized_at=CASE WHEN status IN ('MATERIALIZED','APPROVED','REJECTED') THEN COALESCE(materialized_at,updated_at) ELSE materialized_at END;

CREATE INDEX IF NOT EXISTS idx_v2_ingest_candidates_project_item_status
ON v2_ingest_candidates(project_id,item_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_items_collection_qa
ON automatic_project_items(project_id,collection_status,qa_status,priority,updated_at);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.16.0',unixepoch('now')*1000);
