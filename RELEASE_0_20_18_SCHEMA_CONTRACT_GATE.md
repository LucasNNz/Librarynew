# Corvo Library V2 0.20.18 — Schema Contract Gate

Esta versão corrige o drift entre Worker/MCP e o schema D1 observado no pipeline Coletor → Materialização → QA.

## Correções críticas

- Corrige `materializar_lote`: o `INSERT INTO materialization_items` tinha 23 colunas e 24 valores. Agora o statement possui 20 placeholders variáveis + 3 valores fixos, totalizando exatamente 23 valores para 23 colunas.
- Adiciona reconciliação idempotente do contrato crítico do D1 por `PRAGMA table_info`.
- Repara somente colunas ausentes em `v2_ingest_candidates` e `automatic_project_items`.
- Recria índices críticos com `CREATE INDEX IF NOT EXISTS`.
- Backfill seguro de `discovered_at`, `queued_at` e `materialized_at`.
- Adiciona migration `9017_v2_schema_contract_gate.sql` e schema version `2.17.0`.
- `applyMigrationsFromApp` reconcilia o schema mesmo quando `9016` já consta como aplicada.
- Se `9016` não estiver registrada mas o contrato já estiver satisfeito, ela é registrada como satisfeita em vez de reaplicar `ALTER TABLE` frágeis.

## Gate de readiness

`/health` agora expõe `schemaContract` com:

- `ready`
- `contractVersion`
- `missingTables`
- `missingColumns`

O Core só considera `schema = ok` quando o contrato crítico está completo.

Antes de executar FAST PUSH, materialização, QA, candidatas ou telemetria de materialização, o Worker verifica/reconcilia o schema. O endpoint MCP público também executa este gate antes de ferramentas que possam escrever no pipeline.

O consumer da Queue faz o mesmo gate antes de consumir mensagens. Se o schema não puder ser reconciliado, as mensagens são mantidas para retry em vez de falharem com SQL incompatível.

## Ordem de boot corrigida

O boot agora segue:

1. Core 0.20.18 disponível;
2. `/control/apply-migrations`;
3. reconciliação do schema;
4. `/health` confirma `schemaContract.ready = true`;
5. leitura do D1 real;
6. interface liberada.

A rotina histórica `operational-clean-once` não é mais executada automaticamente no boot. O endpoint continua disponível para manutenção explícita, mas dados de produção não são zerados ao abrir/atualizar a Library.

## Preservação

Nenhuma migration desta versão remove assets, projetos, candidatas ou objetos R2. A correção é aditiva/reconciliadora.

## Gates locais

- baseline + migrations 9000 → 9017: PASS
- schema version final: 2.17.0
- FAST PUSH insert com `discovered_at`: PASS
- `materializar_lote`: 20 placeholders / 20 bindings: PASS
- drift simulado com 9016 registrada e colunas ausentes: reparado
- segunda reconciliação: 0 alterações
- TypeScript frontend estrutural: PASS
- TypeScript Worker estrutural: PASS
- Worker embutido: 0.20.18
- `node --check` no Worker embutido: PASS
