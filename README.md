# Corvo Library V2 0.20.28 — FAST READ + Project Slot Customization

Checkpoint operacional da Corvo Library V2 com **FAST READ**, Project Slots, agentes paralelos e customização manual/MCP.

## Destaques preservados do 0.20.27
- visual de Projetos e seleção múltipla sempre visível;
- concluir, rejeitar e excluir projetos em massa;
- exclusão permanente individual;
- slots de projeto: roteiro, thumbs, títulos, referências, candidatas, aprovadas e ZIP;
- preenchimento manual ou abertura explícita para IA/MCP;
- lifecycle lock preservado para projetos concluídos/rejeitados;
- schema **2.20.0** e migration 9020 preservados.

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
- App/Core/MCP: **0.20.28**;
- schema: **2.20.0**;
- Worker + D1 + R2 + Queue preservados;
- nenhuma migration destrutiva adicionada;
- Worker autoatualizável embutido atualizado para 0.20.28.

Consulte `RELEASE_0_20_28_FAST_READ.md` e `VALIDATION_0_20_28_FAST_READ.json`.
