-- CORVO LIBRARY V2 2.22.0 — Forma final export artifacts
ALTER TABLE v2_download_packages ADD COLUMN revision_hash TEXT;
ALTER TABLE v2_download_packages ADD COLUMN mime_type TEXT;
CREATE INDEX IF NOT EXISTS idx_v2_download_packages_revision_hash ON v2_download_packages(project_id,type,revision_hash,status);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.22.0',unixepoch('now')*1000);
