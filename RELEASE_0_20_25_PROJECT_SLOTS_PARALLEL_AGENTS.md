# Corvo Library V2 0.20.25 — Project Slots & Parallel Agents

## Objetivo
Transformar cada projeto em um slot operacional compartilhado por agentes MCP concorrentes e eliminar o silent no-op do FAST PUSH consolidado quando a cena ainda não existe.

## FAST PUSH multi-cena
- `fast_push_project_candidates` agora cria/upserta deterministicamente a cena/item ausente no projeto.
- `item_id` lógico como `CENA-001` pode ser recebido antes de existir em `automatic_project_items`.
- `target_candidates` e `required_approved` são persistidos no item criado.
- URLs excedentes permanecem `DISCOVERED` como reserva; somente o necessário é ativado.
- Uma operação incapaz de aceitar qualquer item retorna `NO_PROJECT_ITEMS_ACCEPTED`; nunca retorna `COMPLETED` com zero silenciosamente.
- Projeto concluído/rejeitado é protegido por `PROJECT_LOCKED` até reabertura explícita.

## Projeto como slot operacional
Lifecycle separado:
- `ACTIVE`
- `COMPLETED`
- `REJECTED`

Projetos `COMPLETED` ou `REJECTED` recebem `mcp_locked=1`. Reabertura explícita restaura `ACTIVE` e `mcp_locked=0`.

Estados simultâneos por agente:
- `READ`
- `REFERENCE_ANALYSIS_WORKING`
- `REFERENCE_CHECKED`
- `COLLECTOR_WORKING`
- `COLLECTOR_FINISHED`
- `VISUAL_ANALYST_WORKING`
- `VISUAL_ANALYST_FINISHED`
- `DOWNLOADER_WORKING`
- `DOWNLOADER_COMPLETED`
- `THUMBS_WORKING`
- `TITLES_WORKING`

Estados `WORKING` usam owner, execution_id, heartbeat e lease independentes. Expiração volta ao último marco estável configurado sem travar outras frentes do projeto.

## Slots expostos
`obter_slot_projeto` consolida:
- roteiro;
- thumbs (até 3);
- títulos (até 3);
- referências;
- cenas/coleta/candidatas;
- imagens aprovadas;
- ZIP final;
- tags/agentes ativos;
- progresso agregado.

## Operações MCP novas
- `obter_slot_projeto`
- `atualizar_estados_projeto`
- `heartbeat_estados_projeto`
- `concluir_projetos`
- `rejeitar_projetos`
- `excluir_projetos_permanentemente`

## Interface de Projetos
- formulário de criação no topo;
- lista ampla logo abaixo;
- filtros: Últimas 24h, Ativos, Concluídos, Rejeitados, Todos;
- seleção múltipla;
- ações em massa: concluir, rejeitar, excluir permanentemente;
- sem botões `Processar` / `Reconciliar` na lista;
- projeto selecionado abre painel lateral de slots, progresso e agentes/heartbeats;
- projetos fechados exibem `MCP BLOQUEADO` e ação explícita de reabrir.

## Segurança
- migration 9019 é aditiva;
- nenhum cleanup automático;
- assets globais aprovados não são apagados pela exclusão de projeto;
- operações de escrita críticas usam lifecycle guard;
- Queue, D1, R2, idempotência e histórico permanecem como arquitetura principal.
