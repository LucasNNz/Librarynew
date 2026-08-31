# Corvo Library V2 0.20.44 — Atomic PRODUCTION_SLOT Rejection

## Problema corrigido

A primeira implementação de `rejeitar_production_slots_lote` possuía dois defeitos reais:

1. o `INSERT` de `v2_production_slot_history` declarava 12 colunas mas montava 13 valores;
2. cada PSLOT era atualizado antes do histórico/evento e fora de uma transação única, permitindo estado parcial quando um statement posterior falhava.

O erro observado em produção foi:

`D1_ERROR: 13 values for 12 columns`

## Correção SQL

O evento `PRODUCTION_SLOT_REJECTED` agora usa exatamente 12 valores para 12 colunas:

- 10 parâmetros vinculados;
- literal `PRODUCTION_SLOT_REJECTED`;
- `NULL` em `new_asset_id`.

Os inserts de histórico são agrupados em até 10 linhas por statement para respeitar 100 bound parameters.

## Atomicidade

A rota agora segue quatro fases:

1. **preflight somente leitura** de todos os seletores do lote;
2. validação de `operation_id`, seletores, duplicatas e estado legado parcial;
3. construção de todos os statements sem executar mutação antecipada;
4. **um único `env.DB.batch()`** contendo commit marker, guards concorrentes, updates, histórico, eventos, invalidação de exports e SELECTs de contagem.

Se qualquer statement falhar, D1 faz rollback da sequência completa. A resposta é:

`PRODUCTION_SLOT_REJECTION_ROLLED_BACK`

com:

- `mutation_applied: false`
- `rollback: true`
- `atomic: true`

## Concorrência

Antes dos updates, o batch executa guards baseados em:

- `slot_id`
- `asset_id`
- `status`
- `updated_at`

Se o PSLOT mudar entre preflight e commit, o guard provoca falha transacional e nenhum PSLOT do lote é alterado.

## Idempotência forte

Cada `operation_id` recebe:

- `request_fingerprint` determinístico;
- evento determinístico `PRODUCTION_SLOT_REJECTION_BATCH_COMMITTED`.

O marker só persiste se a transação inteira for commitada.

Repetir o mesmo `operation_id` + mesmo payload retorna idempotentemente sem tocar nos slots. Se o slot já tiver sido relinkado depois da rejeição, o novo AST permanece intacto.

Reutilizar o mesmo `operation_id` com outro payload retorna `OPERATION_ID_CONFLICT`.

Para operações parcialmente gravadas pela versão quebrada, os históricos já existentes são reconhecidos como legado; o retry pode completar somente os slots faltantes, desde que o escopo seja compatível.

## Escala

O contrato continua em até **500 PSLOTs**.

No pior caso de 500 rejeições ativas, a transação usa aproximadamente **598 statements**, mantendo os chunks abaixo de 100 bindings por query.

## Preservação

A correção não altera:

- AST global;
- bytes no R2;
- histórico anterior;
- outro PSLOT da mesma cena;
- PITEM/CENA;
- versões anteriores dos exports.

Exports dependentes de imagens continuam apenas marcados `STALE` para regeneração.

## Schema

Permanece em `2.25.0`. Nenhuma migration nova é necessária.
