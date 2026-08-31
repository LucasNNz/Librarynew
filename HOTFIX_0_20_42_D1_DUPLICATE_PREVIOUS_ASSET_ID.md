# Hotfix 0.20.42 — D1 duplicate previous_asset_id

## Sintoma
A UI exibia `D1_ERROR: duplicate column name: previous_asset_id`.

## Causa
`applyMigrationsFromApp()` executa `reconcileCriticalSchema()` antes das migrations pendentes. O contrato 2.25.0 já adiciona `previous_asset_id`, `relink_required_at`, `relink_reason`, `rejected_by`, `rejected_operation_id` e cria `v2_production_slot_history`. Em seguida, se `9025_v2_production_slot_rejection.sql` ainda não constava em `v2_migrations_applied`, o executor tentava aplicar o mesmo `ALTER TABLE ... ADD COLUMN previous_asset_id`, causando o erro de coluna duplicada.

## Correção
- Worker: quando o contrato 2.25.0 já está `READY`, `9025_v2_production_slot_rejection.sql` é registrada como `APPLIED / schema_contract_reconciled` e não é reaplicada.
- Restore: aplica a mesma proteção.
- Restore registry: `VERSION_LAST_MIGRATION` foi atualizado de 2.20.0 até 2.25.0 para reconstrução correta do registro em bancos cujo schema já está atualizado.

## Segurança
Nenhuma coluna, asset, vínculo ou objeto R2 é apagado. O hotfix apenas impede a reaplicação destrutiva/inválida da migration já satisfeita pelo contrato de schema.
