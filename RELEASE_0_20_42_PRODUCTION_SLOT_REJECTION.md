# Corvo Library V2 0.20.42 — Rejeição Individual de PRODUCTION_SLOT

## Objetivo
Permitir QA visual imagem por imagem no nível `PRODUCTION_SLOT`, sem rejeitar a cena/PITEM e sem alterar o AST global da Biblioteca.

## Nova ferramenta MCP
`rejeitar_production_slots_lote`

Entrada:
- `projeto_id`
- `slots[]` com `slot_id` e/ou `target_file`, `motivo` opcional
- `operation_id` opcional
- `rejected_by` opcional
- até 500 slots por chamada

## Comportamento
- preserva AST e objeto físico no R2;
- preserva vínculo anterior em `previous_asset_id` + `v2_production_slot_history`;
- remove apenas o vínculo ativo `PSLOT -> AST`;
- muda somente o PSLOT selecionado para `RELINK_REQUIRED`;
- não altera outros slots da cena;
- não chama `rejeitar_itens_lote` e não muda status do asset global;
- expõe `production_slots_relink_required` e `relink_required_slots` ao Coletor;
- permite criar item técnico `production_slot_relink` somente para o gap aberto;
- `assign_assets_to_slots` fecha o gap e registra `PRODUCTION_SLOT_RELINKED`;
- exports de imagem anteriores são preservados no R2/D1, mas marcados `STALE` para regeneração;
- roteiro/publicação não são invalidados pela troca isolada de imagem.

## Idempotência
O histórico é único por slot/evento/`operation_id`. Retry do mesmo `operation_id` é no-op inclusive se chegar depois de o slot já ter recebido um novo AST, evitando rejeitar o asset novo por uma mensagem atrasada.

## Schema
D1 `2.25.0`:
- novos metadados de relink em `v2_production_slots`;
- nova tabela `v2_production_slot_history`.

## Aceite mínimo validado
- `A.jpg -> AST-A`, `B.jpg -> AST-B`: 2/2 resolvidos;
- rejeitar apenas A: A sem asset/`RELINK_REQUIRED`, B intacto, 1/2 resolvido;
- AST-A e AST-B continuam aprovados e existentes;
- retry não duplica histórico/evento de invalidação;
- relink A com AST-C: A `FROZEN`, B intacto, 2/2 resolvidos;
- retry atrasado da rejeição original preserva AST-C.
