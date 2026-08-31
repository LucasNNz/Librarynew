# Corvo Library V2 0.20.47 — THUMB D1 Cardinality Hotfix

## Problema corrigido

O upload de arquivo local introduzido na 0.20.46 conseguia materializar corretamente a candidata no R2, porém o passo compartilhado de criação do registro `THUMB` em `v2_project_media` falhava com:

`D1_ERROR: 17 values for 16 columns`

A causa estava em `createProjectMediaFromCandidate`: a lista declarava 16 colunas, enquanto `VALUES` possuía 14 placeholders e 3 literais, totalizando 17 valores. Os bindings já eram 13, portanto havia exatamente um `?` excedente no SQL.

## Correção

O INSERT passa a usar:

- 16 colunas;
- 13 placeholders/bindings;
- 3 valores literais (`THUMB`, `THUMB_CANDIDATE`, `0`);
- total efetivo: **16 valores para 16 colunas**.

O helper corrigido é compartilhado pelos caminhos:

- `anexar_thumb_arquivo`;
- `anexar_thumb_projeto(candidate_id)` / `preencher_slot_imagem_projeto`;
- Direct Upload de thumb;
- materialização/FAST PUSH que promove uma candidata para THUMB.

## Recuperação do teste anterior

Uma candidata que já ficou `MATERIALIZED` devido ao erro anterior não precisa ser reenviada ao R2. Após deploy da 0.20.47, basta anexar novamente o mesmo `candidate_id` ao projeto; o helper cria o registro THUMB sem duplicar os bytes.

## Persistência

- nenhuma migration nova;
- schema permanece `2.26.0`;
- D1/R2 existentes são preservados;
- toda a lógica da 0.20.46 de pós-QA, upload local e validação interna de `imagens.zip` permanece intacta.
