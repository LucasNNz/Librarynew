# Corvo Library V2 0.20.29 — Collector Refinements

## 1. Queue low latency V4

A política do consumer passa de `IMMEDIATE_CANDIDATE_V3` para `LOW_LATENCY_CANDIDATE_V4`:

- `batch_size = 10`;
- `max_wait_time_ms = 0`;
- `max_concurrency = null` (autoscaling Cloudflare);
- `max_retries = 4`;
- `retry_delay = 5`;
- mensagens do batch continuam processadas em fan-out paralelo no Worker.

O objetivo é recuperar a latência observada anteriormente com a política de baixa latência, sem aguardar formação de lote.

## 2. Resultado operacional separado da auditoria

`COMPLETED_WITH_ERRORS` continua preservado quando houve falhas históricas reais. Porém as respostas de operação/telemetria agora também retornam:

- `goal_satisfied` / `goalSatisfied`;
- `collection_status` / `collectionStatus`.

Se todas as cenas tocadas pela operação atingiram `target_candidates`, o resultado operacional é:

```json
{
  "status": "COMPLETED_WITH_ERRORS",
  "goal_satisfied": true,
  "collection_status": "COMPLETE"
}
```

Assim um 404 substituído por reserva não é confundido com falha da missão do Coletor.

## 3. Herança semântica no upsert de cena

`fast_push_project_candidates` aceita agora, por item:

- `universo`;
- `sujeito`;
- `conceito`;
- `referencia`;
- `trecho_roteiro`;
- `tags`;
- `urls`.

Quando a cena não existe, o `project_item` auto-criado herda esses metadados. Quando já existe, apenas valores fornecidos atualizam os campos correspondentes.

Mapeamento:

- `universo` → `automatic_project_items.universe`;
- `sujeito` → `term` + estado semântico do Coletor;
- `trecho_roteiro` → `context`;
- `referencia` → `semantic_reference`;
- `conceito/referencia/trecho/sujeito/universo` também ficam preservados em `strategy_state` para não perder distinções sem criar migration destrutiva.

O pacote `get_qa_work_packet` passa a priorizar esses metadados antes dos fallbacks por `item_key`, evitando `subject/concept = CENA-001` quando a semântica foi enviada.

## Compatibilidade

- nenhuma migration D1 nova;
- FAST READ 0.20.28 preservado;
- Project Slot Customization preservado;
- auditoria histórica de falhas permanece intacta.
