# Corvo Library V2 0.20.52 — Responsive Workspace Layout

## Objetivo

Eliminar cortes horizontais e dependência de uma resolução específica na tela de Projetos.

## Mudanças

- O canvas de detalhe do projeto passou a usar `container-type: inline-size`.
- Pipeline, Slots integrados e Arquivos finais usam grades `auto-fit`, reagindo à largura real disponível depois do rail de projetos.
- O rail usa largura fluida com `clamp()` em desktop largo e reduz progressivamente em telas intermediárias.
- A partir de 1180 px de viewport, rail e detalhe passam para uma única coluna para preservar legibilidade.
- Cabeçalho do projeto, status, progresso e botão Excluir reorganizam-se em linha/coluna conforme a largura do canvas.
- IDs, metadados, instruções MCP e botões agora podem quebrar linha sem aumentar a largura do card.
- Artefatos e agentes reduzem colunas ou escondem metadados secundários em canvases estreitos.
- Em canvases muito estreitos, pipeline, slots e arquivos finais passam para uma coluna.
- As correções de scrollbars 0.20.48, geometria de cards 0.20.49, previews 0.20.50 e QA inline 0.20.51 foram preservadas.

## Compatibilidade

- Sem migration D1 nova.
- Schema permanece `2.26.0`.
- Thumb e título continuam opcionais para conclusão do projeto.
- Projetos concluídos continuam separados da fila Em andamento.
