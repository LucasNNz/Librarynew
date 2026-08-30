# Corvo Library V2 0.20.28 — FAST READ

Atualização sobre o checkpoint 0.20.27 Project Slot Customization. O objetivo desta versão é reduzir o custo de leitura e a quantidade de requests necessários para abrir/navegar nas telas, sem trocar Worker, D1, R2 ou Queue.

## Frontend
- Visão Geral usa um único snapshot `/ui/boot` no caminho normal.
- Assets usa `/ui/assets`, página inicial de 36 itens e cursor para próximas páginas.
- Projetos usa `/ui/projects`.
- Análise usa `/ui/analysis`.
- Configurações usa `/ui/settings`.
- `/ui/executions` fica disponível para leitura compacta de execução.
- O catálogo deixou de ser recarregado fora da aba Assets.
- `sessionStorage` hidrata a última visão imediatamente e depois revalida.
- Imagens de catálogo usam lazy loading, decode assíncrono e endpoint de thumbnail.
- `content-visibility:auto` reduz renderização fora da viewport em grids/listas grandes.

## Worker / FAST READ
Novas rotas compactas:
- `GET /ui/boot`
- `GET /ui/assets`
- `GET /ui/projects`
- `GET /ui/executions`
- `GET /ui/analysis`
- `GET /ui/settings`

As respostas usam Cache API do Worker com TTL curto e stale-while-revalidate. Os cabeçalhos `x-corvo-cache`, `x-corvo-fast-read`, `x-corvo-route`, `x-corvo-duration-ms` e `x-corvo-response-bytes` permitem verificar o hot path sem abrir logs completos.

## Thumbnails
- `listAssets` agora devolve URL assinada de `/thumbs/:assetId`, não o link original.
- O Worker procura primeiro `thumbs/assets/<assetId>.webp` no R2.
- Quando há `source_url`, gera WebP de até 420 px via Image Resizing, persiste no R2 e reutiliza nas próximas leituras.
- Para assets legados/importados sem origem remota utilizável, existe fallback ao objeto original para preservar compatibilidade visual. O header `x-corvo-thumbnail: ORIGINAL_FALLBACK` torna esse caso auditável.
- O arquivo original continua sendo o caminho do detalhe/download do asset.

## MCP
- `obter_snapshot_operacional` e `since_version` foram preservados.
- nova ferramenta `obter_resumo_curto`: alias explícito para snapshot incremental no hot path, sem carregar logs/detalhes completos.
- ferramentas completas permanecem para diagnóstico e auditoria.

## Projeto/slots
Todo o comportamento do 0.20.27 foi preservado: seleção múltipla, exclusão permanente, slots manuais, abertura para MCP/IA e lifecycle lock.

## Schema
Nenhuma migration nova é necessária. O contrato continua em **2.20.0**.

## Validação
`VALIDATION_0_20_28_FAST_READ.json`:
- frontend structural typecheck: PASS;
- Worker structural typecheck: PASS;
- D1/schema/recovery: PASS;
- MCP registration contract: PASS;
- bundle Worker embutido: `node --check` PASS.

O build real do Next/Wrangler não foi executado porque o registry npm não respondeu durante esta execução; o validador registra isso como `EXTERNAL_GATE`, não como falha do checkpoint.
