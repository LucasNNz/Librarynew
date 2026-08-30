# Release 0.20.21 — R2 Audit + Queue Low Latency

## Correção 1 — auditoria física R2

As ferramentas `auditar_armazenamento_r2` e `explorar_r2_fisico` não usam mais compound `UNION ALL` nem `DB.batch()` para montar o inventário lógico de referências.

Antes:

`8 fontes D1 → UNION ALL → planner SQLite/D1 → too many terms in compound SELECT`

Agora:

`8 SELECTs independentes → Promise.allSettled → merge no Worker`

Cada fonte é isolada. Se uma tabela histórica opcional falhar, somente aquela fonte é ignorada e registrada em `R2_REFERENCE_SOURCE_SKIPPED`; o restante da auditoria continua.

As operações permanecem somente leitura sobre o inventário físico e não alteram assets ou objetos R2.

## Correção 2 — Queue low latency

O deploy do Worker não garante que um consumer de Queue já existente receba automaticamente os novos parâmetros. Foi mantido o endpoint autenticado:

`POST /control/reconcile-queue-consumer`

Política `LOW_LATENCY_V2`:

- `batch_size = 10`
- `max_wait_time_ms = 0`
- `max_concurrency = null` (autoscaling)
- `max_retries = 4`
- `retry_delay = 5 s`
- Queue `delivery_delay = 0`
- Queue `delivery_paused = false`

O boot chama a reconciliação depois de Core + migrations + schema gate. O botão de atualização chama a mesma operação com `force=true`.

A versão da política foi elevada para `LOW_LATENCY_V2`, portanto uma marca antiga não impede a correção do consumer.

## Coletor

Sem alteração do princípio operacional:

- `400/403/404` → FAILED imediato, sem retry;
- `408/425/429/5xx`, timeout e falhas transitórias → retry/backoff;
- `MATERIALIZED` continua sendo o marco de coleta;
- mensagens de um batch continuam em fan-out paralelo via `Promise.all`;
- Queue permanece entre Control Plane e Data Plane.

## Migrações e dados

Nenhuma migration nova. Schema permanece `2.18.0`.

Nenhum cleanup, reset ou alteração destrutiva em D1/R2.
