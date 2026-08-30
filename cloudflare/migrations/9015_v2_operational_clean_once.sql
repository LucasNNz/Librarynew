-- CORVO LIBRARY V2 2.15.0 — compatibility-only migration
-- Operational cleanup moved to Core 0.20.9, which discovers real tables via
-- sqlite_master. This file intentionally contains no DELETE statements so a
-- legacy D1 with fewer tables cannot crash while applying the manifest.
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.15.0',unixepoch('now')*1000);
