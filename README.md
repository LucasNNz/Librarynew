# Corvo Library V2 0.20.31 — Project Readability + Collector Reference Brief + Project Artifacts + FAST READ

Checkpoint operacional da Corvo Library V2 com **FAST READ**, Project Slots, agentes paralelos e customização manual/MCP.

## Destaques preservados do 0.20.27
- visual de Projetos e seleção múltipla sempre visível;
- concluir, rejeitar e excluir projetos em massa;
- exclusão permanente individual;
- slots de projeto: roteiro, thumbs, títulos, referências, candidatas, aprovadas e ZIP;
- preenchimento manual ou abertura explícita para IA/MCP;
- lifecycle lock preservado para projetos concluídos/rejeitados;
- schema **2.20.0** e migration 9020 preservados.



## Project Readability + Collector Reference Brief 0.20.31
- tela de Projetos ampliada para leitura operacional confortável;
- grid de slots responsivo: 4 colunas no desktop amplo, 3/2 conforme reduz a largura e 1 no mobile;
- novo slot textual **Referências do Coletor** imediatamente após Roteiro;
- slot `reference` aberto ao MCP por padrão, salvo fechamento explícito;
- `anexar_referencias_projeto` grava o TXT inline e incrementa `state_version`;
- `obter_referencias_projeto` devolve conteúdo copiável e links de visualização/download;
- `preencher_slot_texto_projeto` aceita `reference`;
- card de Roteiro e card de Referências oferecem **Ver · Copiar · Baixar** quando o artefato existe;
- snapshot incremental contabiliza `attachments.references`;
- Worker autoatualizável embutido sincronizado com 0.20.31.

## Project Artifacts + SCRIPT Auto Parse 0.20.30
- todo arquivo de projeto confirmado no D1 passa a ficar imediatamente observável pelo MCP via `state_version`;
- materialização, aprovação e rejeição de mídia ligada ao projeto também incrementam `state_version`;
- `listar_arquivos_projeto` lista anexos com preview/download assinados;
- `listar_artefatos_projeto` reúne SCRIPT/REQUIREMENTS, candidatas materializadas, assets aprovados, mídias e ZIPs;
- SCRIPT textual dispara interpretação automática e criação idempotente de cenas;
- parser reconhece `CENA-001`, `[CENA 001]`, `SCENE`, `ID: CENA-001` e `[01]`;
- projetos legados com `SCRIPT READY + total_items=0` recebem self-healing no reconciliador;
- ausência de cenas reconhecíveis vira `SCRIPT_PARSE_NO_SCENES / INTERPRETANDO_ROTEIRO`, em vez de permanecer silenciosamente em `WAITING_FILES`;
- a tela de Projetos expõe `Arquivos e artefatos` com `Ver` e `Baixar` individual.

## Collector Refinements 0.20.29
- Queue volta ao perfil de baixa latência: batch até 10, espera 0 e autoscaling do consumer;
- o fan-out das mensagens continua paralelo no Worker;
- falhas históricas continuam auditáveis em `status`, mas a missão do Coletor ganha `goal_satisfied` e `collection_status`;
- `get_collection_snapshot` expõe esses campos no topo para consumo simples por agendamentos;
- cenas auto-criadas por `fast_push_project_candidates` herdam `universo`, `sujeito`, `conceito`, `referencia` e `trecho_roteiro`;
- o pacote de QA prioriza a semântica enviada e evita cair em `CENA-001` como sujeito/conceito quando os metadados existem.

## FAST READ 0.20.28
- boot normal consolidado em `GET /ui/boot`;
- snapshots compactos por visão: `/ui/assets`, `/ui/projects`, `/ui/executions`, `/ui/analysis` e `/ui/settings`;
- Assets inicia com 36 registros e continua por cursor;
- cache curto no Worker com `stale-while-revalidate`;
- cache/SWR de visão no navegador via `sessionStorage`;
- catálogo não é mais buscado ao navegar por telas que não são Assets;
- previews de Assets usam endpoint assinado `/thumbs/:assetId`;
- thumbnails WebP são geradas on-demand e persistidas em `thumbs/assets/` quando existe `source_url` utilizável;
- assets legados/importados sem `source_url` mantêm fallback compatível ao original para não quebrar cards existentes;
- `loading="lazy"`, `decoding="async"` e `content-visibility` reduzem trabalho de rede/renderização;
- cabeçalhos FAST READ expõem cache HIT/MISS, rota, duração e bytes da resposta;
- MCP mantém `obter_snapshot_operacional` com `since_version` e ganha `obter_resumo_curto` como hot path explícito;
- rotas completas antigas permanecem disponíveis para diagnóstico e compatibilidade.

## Compatibilidade
- App/Core/MCP: **0.20.31**;
- schema: **2.20.0**;
- Worker + D1 + R2 + Queue preservados;
- nenhuma migration destrutiva adicionada;
- Worker autoatualizável embutido atualizado para 0.20.31.

Consulte também `RELEASE_0_20_31_PROJECT_READABILITY_REFERENCE_BRIEF.md`, `VALIDATION_0_20_31_PROJECT_READABILITY_REFERENCE_BRIEF.json`, `BEHAVIOR_GATE_0_20_31_REFERENCE_BRIEF.json` e os documentos das versões anteriores.
