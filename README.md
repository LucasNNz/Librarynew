# Corvo Library V2 0.20.40 — Definitive Images ZIP No-PipeTo

## Correções 0.20.40

- `PROJECT_IMAGES_ZIP` não usa mais `pipeTo`, `tee`, `DigestStream` ou `FixedLengthStream` no hot path.
- O ZIP final é materializado em um `Uint8Array` de tamanho exato, SHA-256 é calculado sobre os bytes finais e o R2 recebe corpo de comprimento conhecido diretamente.
- O buffer é protegido por limite explícito de 96 MiB; acima disso a operação falha de forma clara, sem retornar ao caminho de streaming quebrado.
- Início/retry limpa `r2_key`, `size_bytes`, `sha256` e `ready_at` antigos.
- `FINAL_ARTIFACT_FAILED` persiste estado terminal `FAILED`, erro real e `size_bytes=0`.
- Parser 72/72, 102/102 slots, FAST READ, tags persistentes e os três artefatos independentes permanecem inalterados.
- Schema D1 permanece `2.23.0`.

## Critério de pronto

`PROJECT_IMAGES_ZIP` só é considerado resolvido no runtime quando retornar `READY_FOR_DOWNLOAD`, `size_bytes > 0` e `download_url != null`.

---

# Corvo Library V2 0.20.39 — Images ZIP Stream / Failure State / FAST READ Fix

## Correções 0.20.39
- PROJECT_IMAGES_ZIP: `DigestStream` usado como `WritableStream` real; `FixedLengthStream` preservado.
- FINAL_ARTIFACT_FAILED: status permanece `FAILED` e não é recolocado em `PROCESSING` por retry automático.
- FAST READ: alias SQL reservado `references` substituído internamente por `reference_files`.
- Parser/reconciliador não alterado; smoke 72/72 preservado.
- Schema permanece 2.23.0.

## Tags visuais persistentes 0.20.38

- adiciona `v2_slot_tags` no D1 / schema `2.23.0`;
- qualquer slot pode ter zero, uma ou várias tags persistentes;
- `tag_key` é dinâmica: novos significados podem ser criados por IA/MCP sem deploy;
- criação e remoção são idempotentes e a tag só desaparece após remoção explícita;
- `obter_slot_projeto`, `obter_slots_abertos_projeto` e `obter_modelo_producao` devolvem tags ativas passivamente;
- MCP adiciona `criar_tag_slot`, `remover_tag_slot`, `listar_tags_slot`, `buscar_slots_por_tag` e `listar_tags_projeto`;
- UI mostra emoji flutuante e brilho sutil no slot; duas tags ficam visíveis e excesso aparece como `+N`;
- tooltip mostra emoji, nome, nota e criador;
- não cria workflow novo: o app apenas armazena, mostra e expõe contexto;
- Worker autoatualizável embutido sincronizado com os cinco novos tools e schema 2.23.0.

## Final Export Worker + Scene Reconciliation 0.20.37

- corrige `PROJECT_IMAGES_ZIP` / `PROJECT_SCRIPT_TXT` que podiam permanecer em `PROCESSING` durante drift de cenas;
- o exportador não reconstrói pools nem os 102 production slots para corrigir cenas: faz upsert leve de `v2_production_scenes` em chunks D1;
- slots existentes têm somente `scene_id` reconciliado pelo prefixo numérico do `target_file`; `asset_id`, status FROZEN e referência permanecem intactos;
- parser usa o prefixo dos target files (`065-*` ... `072-*`) como fallback quando um cabeçalho humano não segue um dos formatos canônicos;
- smoke realista: 64 cabeçalhos canônicos + 8 cenas recuperadas por target numerado = 72 production scenes;
- pacote `QUEUED/PROCESSING` estagnado por 90 s é reenfileirado automaticamente sem criar nova coleta/QA/slots;
- preflight das imagens usa concorrência limitada a 10, preservando a ordem final do ZIP;
- arquitetura de três arquivos e schema D1 `2.22.0` permanecem inalterados.

## Forma Final Export 0.20.36

- saída final simplificada em três artefatos independentes: `imagens.zip`, `roteiro.txt` e `thumbs_titulos.zip`;
- `imagens.zip` é flat e contém somente os nomes finais citados no SCRIPT;
- gate de imagens compara SCRIPT ↔ production slots ↔ R2 ↔ índice do ZIP antes de READY;
- formato físico é validado pelos bytes; mismatch JPG/PNG/WEBP exige conversão técnica pelo binding `IMAGES`, nunca simples troca de extensão;
- `roteiro.txt` é UTF-8 e usa exatamente o SCRIPT ativo;
- parser/reconciliação exige `questions_script == production_scenes_total` e repara drift como 72 perguntas / 60 cenas;
- `thumbs_titulos.zip` contém apenas `thumbs/` + `titulos.txt` e não bloqueia os outros dois artefatos;
- os dois ZIPs usam `FixedLengthStream`/body de tamanho conhecido;
- revisão/hash independente permite reutilizar artefatos idênticos;
- exportação pode ser regenerada a partir de projeto concluído sem reabrir/reexecutar coleta, QA ou slots;
- UI mostra **ARQUIVOS FINAIS** com três downloads diretos;
- MCP adiciona `gerar_arquivos_finais_projeto`, `obter_arquivos_finais_projeto` e três ferramentas de link direto;
- schema D1 atualizado para `2.22.0` com `revision_hash` e `mime_type` em `v2_download_packages`;
- Worker autoatualizável embutido sincronizado com 0.20.36.

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
- App/Core/MCP: **0.20.37**;
- schema: **2.22.0**;
- Worker + D1 + R2 + Queue preservados;
- migrations `9021_v2_production_model.sql` e `9022_v2_final_exports_forma.sql` são aditivas e não destrutivas;
- Worker autoatualizável embutido sincronizado e validado em 0.20.37.

Consulte também `RELEASE_0_20_32_MCP3_PRODUCTION_PIPELINE.md`, `VALIDATION_0_20_32_MCP3_PRODUCTION_PIPELINE.json`, `BEHAVIOR_GATE_0_20_32_MCP3_PRODUCTION_PIPELINE.json` e os documentos das versões anteriores.