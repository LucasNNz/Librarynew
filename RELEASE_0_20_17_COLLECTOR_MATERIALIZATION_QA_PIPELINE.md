# Corvo Library V2 0.20.17 — Collector → Materialization → QA Pipeline

Checkpoint acumulativo baseado no 0.20.16.

## Objetivo

Separar de forma explícita coleta, materialização e QA, reduzindo round-trips MCP e a latência entre Queue e R2 sem remover a Queue.

## Estado por cena

`automatic_project_items` passa a persistir:

- `target_candidates` (padrão 8)
- `required_approved` (padrão 1)
- `discovered_count`
- `queued_count`
- `downloading_count`
- `materialized_count`
- `failed_count`
- `approved_count`
- `rejected_count`
- `collection_status`: `EMPTY | COLLECTING | NEEDS_MORE | COMPLETE`
- `qa_status`: `WAITING_COLLECTION | READY_FOR_QA | IN_QA | QA_COMPLETE`

A coleta fecha por **MATERIALIZED**, nunca por APPROVED.

`MATERIALIZED + APPROVED + REJECTED` representam materializações históricas da cena. Portanto, rejeitar durante QA não devolve automaticamente a cena ao Coletor.

## Hot path MCP / HTTP

Novas operações:

- `fast_push_project_candidates`
- `get_collection_snapshot`
- `get_qa_work_packet`
- `submit_qa_decisions`
- `get_materialization_telemetry`

Rotas equivalentes:

- `POST /collector/project-candidates`
- `GET /collector/projects/{project_id}/snapshot`
- `GET /qa/work-packet`
- `POST /qa/decisions`
- `GET /operations/{operation_id}/telemetry`

O FAST PUSH consolidado aceita várias cenas e até 500 URLs válidas por operação, mantendo a materialização assíncrona no Data Plane.

## Queue / Data Plane

Arquitetura preservada:

`MCP / Control Plane → Queue → Consumer → download → R2 → D1`

Ajustes:

- consumer processa mensagens do batch concorrentemente;
- `max_batch_size`: 10;
- `max_batch_timeout`: 1 s no Wrangler;
- `max_wait_time_ms`: 1000 ms no provisionamento via API;
- `max_concurrency: null` no provisionamento via API para autoscaling;
- retry do consumer: 5 s;
- retry técnico de candidata continua com backoff curto e limitado.

## Telemetria

Por candidata:

- `queue_wait_ms`
- `download_ms`
- `r2_write_ms`
- `d1_finalize_ms`
- `total_materialization_ms`

Por operação:

- accepted
- materialized
- failed
- avg queue wait
- avg materialization
- p95 materialization
- avg download
- avg R2 write
- avg D1 finalize

## QA

`get_qa_work_packet` retorna somente cenas `READY_FOR_QA` e candidatas `MATERIALIZED`.

`submit_qa_decisions` aceita APPROVE/REJECT em lote. APPROVE promove para `assets/` e cria `AST-*`; REJECT remove `incoming/` e mantém o histórico lógico no D1.

`target_candidates` e `required_approved` são independentes. Se o QA consumir todo o estoque e ainda faltar aprovação, a cena entra em `NEEDS_RELINK`, sem falsificar uma nova coleta automática.

## Migration

Nova migration aditiva: `9016_v2_collector_qa_pipeline.sql` / schema `2.16.0`.

Não apaga assets, projetos ou histórico existente.

## Compatibilidade acumulada

Preserva as correções 0.20.11–0.20.16, incluindo fila de ZIPs, MCP público do GPT, uploads R2 com tamanho conhecido, download de export e CLEAN_ZERO one-shot.
