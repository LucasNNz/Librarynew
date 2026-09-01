# Validação 0.20.53 — D1 Read Optimization

## Resultado

- TypeScript App estrutural: **PASS**
- TypeScript Core estrutural: **PASS**
- Behavior gate 0.20.53: **44/44 PASS**
- Migration/query-plan gate 9027: **14/14 PASS**
- Schema: **2.27.0**
- Migration: `9027_v2_d1_read_optimization.sql`

## Query plans validados em SQLite

As consultas representativas escolheram explicitamente os novos índices:

- projetos acionáveis → `idx_automatic_projects_actionable`;
- PITEM por projeto/status → `idx_project_items_project_status`;
- claim de worker READY → `idx_worker_ready_claim`;
- PSLOT por projeto/versão/status → `idx_v2_production_slot_project_version_status`;
- tag de slot → `idx_v2_slot_tags_project_key_active`;
- arquivo por projeto/role → `idx_project_files_project_role`.

## Regressões arquiteturais verificadas

O behavior gate confirma ainda:

- `obter_resumo_curto` não toca em arquivos/candidatas/R2 e faz short-circuit por `state_version`;
- listagem administrativa não executa expiração global de tags;
- reconciliação não possui mais SELECT de worker por PITEM;
- PSLOT→PITEM possui checkpoint de reconciliação;
- resolução de políticas dos slots é batch;
- compactação READY preserva histórico como `CANCELLED`;
- dispatcher usa somente projetos acionáveis;
- telemetria é não bloqueante;
- ranking de performance usa a nova tabela, com fallback legado;
- QA inline, responsividade, publicação opcional e upload local de thumb continuam presentes.

## Limite da validação local

Esta validação prova a estrutura, os SQLs e os query plans em SQLite. A redução real de `rows_read` da conta Cloudflare deve ser observada após deploy usando `obter_performance_mcp` e as métricas do painel D1, porque o volume real depende dos dados e da carga de produção.
