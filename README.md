# Corvo Library V2 0.20.35 — Fixed-Length ZIP Export Recovery

## ZIP / R2 infrastructure recovery 0.20.35

- project production ZIP and generic asset ZIP now preflight every unique R2 object with `HEAD`;
- exact ZIP byte length is calculated before upload;
- the ZIP stream is piped through Cloudflare `FixedLengthStream(expectedSize)` before `R2.put`;
- the same physical AST can still appear in multiple production slots/target filenames without duplicating its R2 object;
- R2 output size is verified against the expected ZIP length before a package is marked READY;
- package infrastructure failures automatically clear `DOWNLOADER_WORKING`, record `PACKAGE_EXPORT_BLOCKED`, and park the project at `PACKAGE_BLOCKED_INFRASTRUCTURE`;
- successful regeneration records `PACKAGE_EXPORT_READY`, clears the downloader working tag, and reconciles the existing saved project state without re-running collection, QA, rotations, scenes, or slots.

## FAST READ Boot / D1 Recovery 0.20.34

- corrige o falso `FAST_READ_BOOT_FAILED` após atualização do Core quando `caches.default` ainda contém `/ui/boot` de uma release anterior;
- toda chave do cache FAST READ recebe namespace da release (`__corvo_release=0.20.34`), impedindo colisão entre Workers antigos e novos;
- após self-update/migrations, o frontend executa leitura de boot com cache-bust único antes de validar D1/schema;
- `schemaGateDetail` lê `health.core`, portanto `d1`, `schema` e `schemaContract` deixam de aparecer como `null` apenas por causa do envelope do boot;
- resposta HTTP de falha em `/control/update-core` agora interrompe o fluxo com o erro real, em vez de terminar acusando o D1;
- schema D1 permanece `2.21.0`; não há migração destrutiva ou reset de dados nesta release.

## Inline References No-Ticket 0.20.33

O slot **Referências do Coletor** possui caminho textual MCP obrigatório e autocontido:

- `anexar_referencias_projeto(projeto_id, conteudo, nome_arquivo?, agente?)`;
- grava bytes diretamente no R2 e índice/versão no D1 em uma única chamada;
- devolve `slot_key=reference`, `slot_state=READY`, conteúdo copiável, preview e download;
- incrementa `state_version` quando há mudança física;
- mantém o slot explicitamente aberto para MCP;
- chamada idempotente pelo hash do conteúdo;
- se o registro D1 existir e o objeto R2 tiver sumido, a mesma chamada restaura o arquivo físico;
- `anexar_arquivo_projeto` **não pode** gerar ticket/PUT externo para SCRIPT nem para roles de Referências; nesses casos aponta para a ferramenta inline correta;
- endpoint HTTP equivalente: `POST /projects/:projectId/references/inline`.

Isso elimina o caso em que o slot de Referências era aberto corretamente, mas o TXT ficava em `WAITING` porque um ticket de PUT externo falhava por DNS.


Checkpoint operacional da Corvo Library V2 com **FAST READ**, Project Slots, agentes paralelos e customização manual/MCP.

## MCP3 Production Pipeline 0.20.32
- separa explicitamente `REFERENCE_POOL`, `PRODUCTION_SCENE` e `PRODUCTION_SLOT`;
- migration `9021_v2_production_model.sql` / schema `2.21.0`;
- SCRIPT cria/reconcilia idempotentemente cenas e slots finais por `target_file`;
- `assign_assets_to_slots` associa até 500 slots a AST existentes sem copiar bytes no R2;
- o mesmo AST pode atender vários `target_file` (relação asset 1:N production slots);
- `criar_slots_projeto_lote` faz upsert idempotente por `target_file`;
- `FAST_APPROVE_PROJECT_ITEMS` consegue resolver slot pelo `target_file` mesmo sem item legado;
- ZIP de projeto usa manifesto `production_slot.target_file -> asset_id` e preserva repetições lógicas do mesmo asset;
- projeto só pode concluir quando os production slots exigidos estiverem resolvidos e o pacote requerido estiver pronto;
- QA normal usa ACK assíncrono + Queue com chunks internos de 10; a rota síncrona fica apenas para diagnóstico/compatibilidade;
- snapshots/UI expõem contagens separadas de pools, cenas e slots, evitando usar `total_items` como indicador único.

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
- App/Core/MCP: **0.20.35**;
- schema: **2.21.0**;
- Worker + D1 + R2 + Queue preservados;
- migration `9021_v2_production_model.sql` é aditiva e não destrutiva;
- Worker autoatualizável embutido sincronizado e validado em 0.20.35.

Consulte também `RELEASE_0_20_32_MCP3_PRODUCTION_PIPELINE.md`, `VALIDATION_0_20_32_MCP3_PRODUCTION_PIPELINE.json`, `BEHAVIOR_GATE_0_20_32_MCP3_PRODUCTION_PIPELINE.json` e os documentos das versões anteriores.