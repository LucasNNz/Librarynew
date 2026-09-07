# Corvo Library V2 0.20.58 — Project Integrity Repair

Release de reparo estrutural seguro para os dois tipos de bloqueio encontrados no Boku: colisões históricas de `worker_work_items` no contrato `UNIQUE(scope_type,scope_id,stage)` e PSLOTs legados ausentes do SCRIPT atual.

## Novas ferramentas MCP

1. `listar_conflitos_worker_work_items_unique` — leitura somente, por projeto opcional.
2. `deduplicar_worker_work_items_unique` — dedupe/reuso atômico e idempotente, sem DELETE.
3. `reparar_worker_work_items_projeto` — dedupe + stale cleanup + lease recovery + reconcile + validação final.
4. `listar_production_slots_obsoletos` — compara SCRIPT atual × PSLOTs ativos.
5. `aposentar_production_slots_obsoletos` — dry-run por padrão; aposenta em D1.batch, preserva histórico/R2/ASTs e reconcilia PITEM/workers.
6. `reparar_integridade_projeto` — dry-run por padrão; em apply exige `confirmar=true` e suporta idempotência por `operation_id`.

## Correção do UNIQUE na reconciliação normal

`reconciliar_projeto_automatico` deixa de presumir que ausência de READY/LEASED significa chave livre:

- `CANCELLED` / `FAILED` / `SUPERSEDED` na chave estrita: reutiliza a mesma linha e volta para READY;
- `COMPLETED`: preserva a linha histórica e cria trabalho novo com `scope_type=PROJECT_ITEM_REVISION` e `scope_id` revisionado;
- não apaga worker history para abrir espaço.

Isso elimina o erro de INSERT por `UNIQUE(scope_type,scope_id,stage)` sem sacrificar histórico concluído.

## PSLOT obsoleto

O listador usa o SCRIPT mais recente armazenado no R2 como autoridade. Um PSLOT ativo cujo `target_file` não está mais no SCRIPT é reportado com `reason=NOT_PRESENT_IN_CURRENT_SCRIPT`.

A aposentadoria:

- muda somente os PSLOTs obsoletos para `RETIRED`;
- mantém AST/candidate/R2 intactos;
- grava `PRODUCTION_SLOT_RETIRED` no histórico;
- muda PITEM correspondente para `RETIRED / DONE / COMPLETE / qa_status=RETIRED`;
- cancela apenas worker READY/LEASED ligado ao PITEM aposentado;
- incrementa `state_version` e recalcula contagens depois.

## Compatibilidade

- schema permanece `2.27.0`;
- nenhuma migration D1 nova;
- QA por rejeição, aposentadoria 0.20.57, índices 9027, autenticação por navegador e UI 0.20.56 permanecem preservados.
