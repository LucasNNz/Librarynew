-- CORVO LIBRARY V2 2.13.0 — live factory-zero gate
-- 0.20.3 must start empty even when an older cleanup migration was already marked as applied.
-- The Worker performs one explicit idempotent reset and flips this release marker to DONE.
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('schema_version','2.13.0',unixepoch('now')*1000);
INSERT OR REPLACE INTO v2_schema_meta(key,value,updated_at)
VALUES ('factory_zero_release_0_20_3','PENDING',unixepoch('now')*1000);

DELETE FROM v2_maintenance_state;
INSERT INTO v2_maintenance_state(key,status,detail_json,attempts,created_at,updated_at,completed_at)
VALUES (
  'PURGE_FACTORY_ZERO_R2_0_20_3',
  'PENDING',
  '{"prefixes":["assets/","imports/","projects/","incoming/","batches/","exports/","corvo-core/recovery/"],"preserveBucket":true,"refreshRecovery":false,"reason":"0.20.3 live factory-zero gate"}',
  0,
  unixepoch('now')*1000,
  unixepoch('now')*1000,
  NULL
);
