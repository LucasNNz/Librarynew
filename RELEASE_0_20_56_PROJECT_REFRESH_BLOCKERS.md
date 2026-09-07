# Release 0.20.56 — Project Refresh + Blocker Summary

## Objetivo

Tornar o estado de um projeto legível em segundos para humano e MCP, sem reintroduzir polling pesado no D1.

## Atualização do projeto

- novo botão **Atualizar** no detalhe do projeto;
- a primeira checagem usa `state_version` pela rota curta `/projects/:id/short`;
- quando nada mudou, responde `not_modified` e não remonta arquivos, artefatos, políticas ou R2;
- quando houve mudança, o app atualiza slot, artefatos, arquivos finais e lista de projetos;
- os antigos timers de 5s/7s/8s/12s da tela de Projetos foram removidos;
- não existe polling automático de projetos nesta release para não consumir rows_read do D1 enquanto a página está parada.

## O que falta para concluir

O detalhe do projeto ganhou um painel visível **O QUE FALTA PARA CONCLUIR** com:

- slots sem imagem;
- slots em `RELINK_REQUIRED`;
- imagens em `ASSIGNED_FOR_QA`;
- slots ainda não FROZEN;
- ausência de SCRIPT;
- `imagens.zip` ainda não pronto;
- `roteiro.txt` final ainda não pronto;
- próxima frente responsável: Roteirista, Coletor, Analista visual, Baixador ou Supervisor.

Thumbs, títulos e `thumbs_titulos.zip` continuam explicitamente opcionais e não bloqueiam conclusão.

## Fonte de verdade visual

O card **Coleta / candidatas** deixa de usar o alvo histórico de candidatas como indicador principal quando existe modelo de produção. Passa a usar os `PRODUCTION_SLOTs`:

- abastecidos;
- sem imagem;
- relink.

Isso evita estados enganadores como “Coletor 22%” quando quase todos os PSLOTs já estão FROZEN.

## MCP

Nova ferramenta:

`obter_pendencias_projeto(projeto_id)`

Retorna um resumo indexado de blockers sem ler R2, candidatas, políticas, logs ou conteúdo de arquivos. `listar_projetos_acionaveis` agora recomenda esse caminho antes de `obter_slot_projeto`.

Fluxo recomendado:

`listar_projetos_acionaveis → obter_pendencias_projeto → obter_slot_projeto somente se necessário`

## Schema

Permanece **2.27.0**. Nenhuma migration nova.
