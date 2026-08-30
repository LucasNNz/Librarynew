# Corvo Library V2 0.20.21 — R2 Audit + Queue Low Latency

Checkpoint sobre a 0.20.20 que corrige dois problemas operacionais observados em produção:

1. `auditar_armazenamento_r2` e `explorar_r2_fisico` falhavam com `D1_ERROR: too many terms in compound SELECT`;
2. o FAST PUSH materializava em paralelo, mas a Queue mantinha ~7 s de espera antes de `DOWNLOAD_STARTED` porque a configuração do consumer não era reconciliada quando apenas o Worker era atualizado.

Garantias desta versão:

- as auditorias físicas do R2 não usam mais `UNION ALL` nem `DB.batch()` para juntar referências; cada fonte do D1 é consultada independentemente e os resultados são agregados no Worker;
- cada fonte é isolada por `Promise.allSettled`; uma tabela histórica opcional ausente não derruba a auditoria;
- o Core aplica a política `LOW_LATENCY_V2` ao consumer: `batch_size=10`, `max_wait_time_ms=0`, `max_concurrency=null`, `max_retries=4`, `retry_delay=5`;
- a Queue também é reconciliada para `delivery_delay=0` e `delivery_paused=false`;
- a política é aplicada automaticamente após update/migrations e pode ser forçada pelo botão de atualização;
- HTTP 400/403/404 continuam falhando imediatamente e não entram em retry; somente falhas transitórias recebem backoff;
- nenhuma migration nova;
- nenhum reset/cleanup;
- R2/D1/assets existentes não são alterados pela auditoria.
