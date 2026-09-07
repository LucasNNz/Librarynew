# Corvo Library V2 0.20.57 — Legacy PSLOT Retirement

## Objetivo
Corrigir a reconciliação de projetos cujo SCRIPT atual removeu/substituiu um target_file, mas o PRODUCTION_SLOT legado continuou ativo e passou a bloquear o projeto como PENDING.

## Correções
- O SCRIPT atual passa a ser autoridade também sobre o conjunto ativo de `target_file`, não apenas sobre a contagem de cenas.
- `reconciliar_projeto_automatico` compara o conjunto de targets do SCRIPT com os PSLOTs ativos; divergência dispara reconciliação de produção mesmo quando a quantidade de cenas é igual.
- PSLOT existente que não aparece mais no SCRIPT é preservado com `status='RETIRED'`.
- PSLOT `RETIRED` é excluído de contagens, QA, relink, conclusão e `imagens.zip`.
- Histórico é preservado com `PRODUCTION_SLOT_RETIRED` / `SCRIPT_NO_LONGER_REFERENCES_SLOT`.
- Assets, candidatas e objetos R2 do slot aposentado não são apagados.
- O PITEM legado correspondente é reconciliado para `RETIRED`, `DONE`, `COMPLETE`, `qa_status='RETIRED'`.
- `qa_status` nunca recebe `NULL`: `COLLECTING` usa `WAITING_COLLECTION`.
- Workers READY/LEASED de PITEM aposentado são cancelados, preservando histórico.
- PITEMs `RETIRED` não contam no total operacional e não recriam jobs.
- Se um target aposentado voltar ao SCRIPT em uma revisão futura, o PSLOT pode ser reativado; mídia antiga vinculada volta como `ASSIGNED_FOR_QA`, nunca como aprovação silenciosa.

## Compatibilidade
- Schema permanece `2.27.0`.
- Nenhuma migration nova.
- 97 slots FROZEN existentes não são reabertos quando o 98º slot legado é aposentado.
