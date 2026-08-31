-- Corvo Library V2 — provisional PSLOT assignment + QA by rejection
-- Schema 2.26.0

ALTER TABLE v2_production_slots ADD COLUMN candidate_id TEXT REFERENCES v2_ingest_candidates(id);
ALTER TABLE v2_production_slots ADD COLUMN previous_candidate_id TEXT REFERENCES v2_ingest_candidates(id);
ALTER TABLE v2_production_slots ADD COLUMN assigned_for_qa_at INTEGER;
ALTER TABLE v2_production_slots ADD COLUMN qa_finalized_at INTEGER;
ALTER TABLE v2_production_slots ADD COLUMN qa_operation_id TEXT;
ALTER TABLE v2_production_slots ADD COLUMN assignment_source TEXT;

ALTER TABLE v2_production_slot_history ADD COLUMN previous_candidate_id TEXT REFERENCES v2_ingest_candidates(id);
ALTER TABLE v2_production_slot_history ADD COLUMN new_candidate_id TEXT REFERENCES v2_ingest_candidates(id);

CREATE INDEX IF NOT EXISTS idx_v2_pslot_assigned_for_qa
  ON v2_production_slots(project_id,status,updated_at DESC)
  WHERE status='ASSIGNED_FOR_QA';
CREATE INDEX IF NOT EXISTS idx_v2_pslot_candidate
  ON v2_production_slots(candidate_id)
  WHERE candidate_id IS NOT NULL;

-- Grandfather final <=2.25.0 assignments into the canonical final state.
UPDATE v2_production_slots
SET status='FROZEN',
    qa_finalized_at=COALESCE(qa_finalized_at,updated_at),
    assignment_source=COALESCE(NULLIF(assignment_source,''),'LEGACY_QA_APPROVED')
WHERE asset_id IS NOT NULL AND candidate_id IS NULL
  AND status IN ('RESOLVED','APPROVED','COMPLETED');

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.26.0',unixepoch('now')*1000);
