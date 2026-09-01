# Release 0.20.53 — D1 Read Optimization

## Objetivo

Reduzir `rows_read` do Cloudflare D1 sem diminuir a frequência dos agentes. A release troca varreduras pesadas por um control plane indexado, elimina N+1 conhecidos, compacta a fila READY sem apagar histórico e passa a registrar telemetria por rota MCP.

## Control plane leve

- Nova MCP `listar_projetos_acionaveis` retorna apenas projetos `ACTIVE` com `next_action` real, estado mínimo, presença de SCRIPT/referências, contagem de títulos/thumbs e tags.
- `listar_projetos_automaticos` permanece para UI/administração e não executa mais expiração/reconciliação global durante simples listagem.
- `obter_resumo_curto` não chama mais snapshot pesado. Faz leitura por PK do projeto e, apenas se `state_version` mudou, uma agregação indexada dos PSLOTs.
- `since_version == state_version` retorna `not_modified:true` antes de ler PSLOTs.
- `obter_slot_projeto` continua disponível, mas é explicitamente rota de detalhe depois da seleção do projeto.

## Reconciliação sem N+1

- `reconciliar_projeto_automatico` lê PITEMs + trabalhos ativos de worker em batch e constrói o mapa em memória; deixou de consultar `worker_work_items` uma vez por item.
- PSLOT → PITEM usa `production_reconciled_at`. Se nenhum PSLOT mudou desde a última reconciliação, retorna `UP_TO_DATE` sem reler PITEMs/cenas/slots.
- `state_version` e eventos só mudam quando houve mudança real de estado, criação de work item ou recuperação de SCRIPT.
- O detalhe visual do projeto não força mais agregação derivada de PITEMs a cada abertura.
- Políticas dos slots são resolvidas em batch compartilhado, evitando uma consulta completa por slot.

## Fila READY

Nova MCP `compactar_fila_workers` cancela logicamente, preservando histórico:

- READY cujo PITEM/projeto pai não existe;
- READY de projeto encerrado/rejeitado/cancelado;
- READY cujo PITEM já está terminal, `FROZEN` ou `ASSIGNED_FOR_QA`;
- READY duplicado para o mesmo `project_id + item_id + worker_type + stage`.

`executar_dispatcher_workers` compacta a fila e reconcilia somente projetos retornados pelo control plane acionável.

## Índices / schema 2.27.0

Migration `9027_v2_d1_read_optimization.sql` adiciona `production_reconciled_at`, a tabela de telemetria e índices nos hot paths:

- `automatic_projects` acionáveis;
- `automatic_project_items(project_id,status,...)`;
- `worker_work_items` READY/LEASED/projeto/item;
- `v2_production_slots(project_id,version,status,...)`;
- tags de workflow e slot;
- arquivos de projeto;
- candidatas;
- mídia/títulos;
- pacotes finais;
- políticas operacionais.

O schema contract local e o restore remoto recriam esses índices antes de registrar a 9027 como satisfeita, evitando o problema histórico de `duplicate column` em replays de `ALTER TABLE`.

## Telemetria D1 por rota MCP

Nova tabela `v2_mcp_route_telemetry` registra:

- ferramenta MCP;
- sucesso/falha;
- duração;
- número de queries D1;
- queries com `meta` disponível;
- `rows_read` e `rows_written` observados quando a API D1 fornece `meta`.

`obter_performance_mcp` agora retorna ranking por `rows_read_observed`, queries e chamadas, além de visão das últimas 24 horas. `mcp_audit` permanece somente como fallback para Core anterior à migration 9027.

> Observação: `rows_read_observed` é exato somente nas operações D1 que devolvem `meta`; `first()`/`raw()` ainda entram em `db_query_count`, mas não conseguem reportar rows lidas pela API atual.

## Compatibilidade preservada

A release mantém:

- QA por rejeição e `ASSIGNED_FOR_QA`;
- previews inline MCP sem navegador/permissão;
- upload local de thumb;
- fechamento sem thumb/título obrigatório;
- workspace responsivo da 0.20.52;
- rejeição de PSLOT atômica/idempotente.
