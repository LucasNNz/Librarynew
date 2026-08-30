-- CORVO LIBRARY V2 2.14.1 — safe compatibility marker
--
-- Previous checkpoint content under this migration name deleted operational
-- catalog and project data during application boot. Opening or updating the UI
-- must never be destructive. Keep the filename for migration-registry
-- compatibility, but only advance non-destructive schema metadata.
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.14.1',unixepoch('now')*1000);

INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('authoritative_boot_mode','READ_ONLY',unixepoch('now')*1000);
