# Corvo Library V2 0.20.19 — D1 Safe Migration Executor

## Correção principal

O aplicador do Worker não envia mais um arquivo SQL inteiro para `D1Database.exec()`. O executor agora:

1. remove comentários SQL de forma segura;
2. separa somente em `;` fora de strings/comentários;
3. ignora `PRAGMA foreign_keys=ON/OFF` legado no caminho Worker;
4. prepara cada statement completo;
5. executa a migration em `DB.batch()` transacional.

Isso corrige o erro observado em `9008_v2_operational_cleanup_recovery.sql`:

`D1_EXEC_ERROR: ... incomplete input`

## Proteção de dados

As migrations abaixo são one-shot históricos de reset e **não são forward migrations**:

- `9008_v2_operational_cleanup_recovery.sql`
- `9010_v2_clean_zero_baseline.sql`
- `9011_v2_purge_all_projects.sql`
- `9012_v2_factory_zero_assets.sql`
- `9013_v2_live_factory_zero_gate.sql`

No boot/update de uma Library existente elas são registradas em `v2_migration_decisions` com:

`SKIPPED_LEGACY_DESTRUCTIVE`

sem executar os `DELETE`/intentos de purge R2.

## Migration 9018

`9018_v2_safe_live_migration_executor.sql` é aditiva e recria somente estruturas seguras que versões históricas colocavam dentro de migrations de limpeza:

- `v2_recovery_events`;
- `v2_maintenance_state`;
- `v2_migration_decisions`;
- `v2_runtime_heartbeats` + índices;
- `migration_executor_policy=SAFE_LIVE_V1`;
- `schema_version=2.18.0`.

## Validação

Cenário simulado equivalente ao reportado:

- registry aplicado até `9007`;
- 604 assets existentes;
- `9008` pendente.

Resultado:

- assets antes: 604;
- assets depois: 604;
- 5 migrations destrutivas históricas puladas;
- migrations forward aplicadas;
- 47 statements seguros processados no teste SQLite equivalente;
- schema final: `2.18.0`;
- TypeScript frontend: PASS;
- TypeScript Worker: PASS;
- Worker embutido: `node --check` PASS.
