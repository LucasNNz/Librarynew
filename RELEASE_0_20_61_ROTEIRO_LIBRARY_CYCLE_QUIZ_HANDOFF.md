# Release 0.20.61 — Roteiro Library Cycle + QA → Quiz

Implementação limitada aos 13 pontos solicitados para Roteiro/Coletor/QA/Quiz.

## Implementado

- `obter_catalogo_roteiro`: somente APPROVED, payload compacto, filtros, cursor e ordenação nunca usados/menos usados.
- `buscar_assets`: normalização case-insensitive, remoção de acentos e índice textual normalizado persistente/invalidation-safe.
- Ciclo persistente `LIBRARY_ONLY ×3 → HYBRID ×2`, com reserva e avanço somente depois de SCRIPT válido materializado.
- Projeto persiste `visual_strategy`, `cycle_position` e `creation_operation_id`.
- SCRIPT materializa Production Scenes/Slots com `subject`, `universe`, `reference`, `context`, `preset` e segue para atribuição Library-first.
- Até 3 títulos persistidos no próprio projeto; rota já existente ganhou contrato explícito de Roteiro.
- `LIBRARY_ONLY` bloqueia coleta e atribuição externas; `HYBRID` permite externo somente após Biblioteca.
- Coletor recebe somente gaps `UNRESOLVED/PENDING/RELINK_REQUIRED`, nunca `ASSIGNED_FOR_QA/FROZEN`.
- QA visual continua em `RELINK_REQUIRED`; erro semântico usa `REFERENCIA_ATENÇÃO` e volta ao Roteiro.
- QA completo faz handoff automático `next_action=QUIZ_RENDER`.
- `obter_payload_quiz_projeto`: SCRIPT + 3 títulos + cenas + presets + slots + `asset_id` final.
- `processar_quiz_render`: somente `QUIZ_RENDER`, cria/reutiliza Quiz por `project_id`, importa snapshot, acompanha jobs, gera MP4, marca `VIDEO_READY`; falha preserva `QUIZ_RENDER` para retry.
- Idempotência reforçada em criação de projeto, avanço do ciclo, atribuição de assets, coleta e render.

## Migration

- `9029_roteiro_cycle_quiz_handoff.sql`
- schema contract: `2.29.0`

## Deploy

O source ZIP mantém `lib/generated-core-bundle.ts` em `UNBUILT` de propósito. O script `prebuild` usa `esbuild` para regenerar o bundle a partir de `cloudflare/src/index.ts` no build do ambiente de deploy. Isso evita publicar acidentalmente o bundle 0.20.60 anterior.

## Validação realizada

- Cloudflare/Core structural TypeScript: PASS.
- App/frontend structural TypeScript: PASS.
- Migration 9029 em SQLite mínimo compatível: PASS.
- Gate específico dos requisitos: 30/30 PASS.
- Coerência App/Core/setup: 0.20.61 + schema 2.29.0.

## Limitação do ambiente de validação

O teste `npm run test:quiz` não pôde ser executado neste container porque as dependências não estavam instaladas e o registry npm estava indisponível por falha DNS (`EAI_AGAIN`). O teste exige `esbuild`. Nenhuma dependência incompleta foi incluída no ZIP.
