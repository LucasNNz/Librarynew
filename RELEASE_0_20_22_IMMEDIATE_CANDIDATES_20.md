# Release 0.20.22 — Immediate Candidates 20

## Objetivo

Executar candidatas imediatamente e de forma independente, com teto inicial de 20 tarefas simultâneas, sem espera de formação de lote e sem bloquear uma candidata pela duração de outra.

## Queue

Política nova: `IMMEDIATE_CANDIDATE_V3`.

- `batch_size = 1`
- `max_wait_time_ms = 0`
- `max_concurrency = 20`
- `max_retries = 4`
- `retry_delay = 5`
- `delivery_delay = 0`
- `delivery_paused = false`

A política é reconciliada no consumer existente pelo Control Plane e também é usada no provisionamento de uma instalação nova.

## Reserva e reposição automática

`fast_push_project_candidates` persiste todas as URLs novas no D1, mas enfileira somente a quantidade necessária para completar `target_candidates` considerando MATERIALIZED + tarefas ativas.

URLs excedentes permanecem `DISCOVERED` como reserva vinculada ao mesmo projeto/item.

Ao término definitivo de uma falha, o Worker calcula novamente a necessidade da cena e promove reservas imediatamente. A reserva é da cena inteira e pode pertencer a uma operação diferente, permitindo cooperação entre agentes MCP concorrentes.

Se a reserva acabar antes de atingir a meta, o snapshot retorna `NEEDS_MORE`; a Library não inventa uma URL externa por conta própria.

## Política de erro

- `HTTP 400/403/404`: falha final imediata, sem retry, não conta para a meta e aciona reposição.
- `408/425/429/5xx`, timeout/erro de rede transitório: retry controlado; só aciona reposição após falha final.

## Idempotência

- candidato de projeto/item recebe ID estável derivado de `project_id + item_id + URL normalizada`;
- `INSERT OR IGNORE` protege corrida entre FAST PUSH simultâneos;
- o consumer faz claim atômico com `WHERE status IN ('QUEUED','RETRYING')`;
- uma redelivery concorrente que perde o claim apenas executa `ack`, sem novo download/R2/D1.

## Snapshot

O snapshot por cena inclui `reserve`. `NEEDS_MORE` só é emitido quando a cena continua abaixo da meta e `reserve = 0`.

## Compatibilidade

Sem migration nova. Schema permanece `2.18.0`. Auditorias R2, MCP público, known-length R2, safe migrations e schema gate das versões anteriores permanecem preservados.
