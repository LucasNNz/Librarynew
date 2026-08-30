# Corvo Library V2 — Checkpoint 0.20.0

Corvo Library V2 com **baseline CLEAN ZERO + importação R2-ready**. O 0.20 preserva a limpeza do 0.19 e adiciona um caminho seguro para iniciar o catálogo do zero a partir das imagens já organizadas.

## O que muda no 0.20

- nova área **Assets → Importar & R2**;
- importação de múltiplos ZIPs com progresso por lote;
- limite seguro de **48 MiB por ZIP**, evitando processar arquivos gigantes inteiros no Worker;
- ID de asset **estável por SHA-256**, tornando reimportação idempotente;
- classificação do manifesto aplicada automaticamente ao Catálogo/Pendentes;
- metadata de recuperação gravada junto do objeto em R2;
- reconciliação paginada `R2 assets/ × D1`, com reparo R2→D1 quando há evidência;
- D1→R2 é validado: arquivo físico ausente é sinalizado, nunca inventado;
- ZIP de transporte apagado depois da materialização, evitando duplicar centenas de MB no bucket;
- auditoria/explorador reconhecem recovery sidecars como referências físicas válidas;
- `Sem universo` não infla o KPI de universos aprovados.

Detalhes: `docs/IMPORT_R2_SYNC_0_20.md`.

## Clean Zero preservado

Ao aplicar `9010_v2_clean_zero_baseline.sql` no D1 existente:

- assets, usos, lotes, projetos, candidatas, execuções, materializações, auditorias, logs e estados recuperados ficam zerados;
- `settings`, fontes, perfis, limites de workers, políticas e manifesto de infraestrutura permanecem;
- nenhuma credencial é restaurada ou gravada no D1;
- nenhuma rotina de purge do R2 é criada.

O bucket `corvoquiz-prod` continua sendo o mesmo bucket configurado e parte vazio neste baseline.

## Bootstrap

Instalações novas usam `bootstrap/CORVO_LIBRARY_V2_D1_CLEAN_BASELINE.sql.gz`: schema histórico compatível + configurações seguras, sem assets recuperados.

Baseline validado após migrations:

- Assets: 0
- Aprovados: 0
- Pendentes: 0
- Rejeitados: 0
- Usos: 0
- Projetos: 0
- Candidatas: 0
- Foreign-key violations: 0
- Schema: 2.10.0
- Data baseline: `CLEAN_ZERO`

## MCP / Heartbeats

Compatibilidade preservada: **244 tools MCP únicas** (229 da matriz histórica + 17 extras V2, considerando 2 substituições históricas), com heartbeats de Worker, Supervisor e Operação intactos.

## UI

A base visual minimalista permanece:

- Visão geral com rede de agentes e projetos;
- sidebar curta;
- Assets com **Catálogo · Pendentes · Rejeitados · Importar & R2**;
- cards de catálogo focados em imagem, nome, universo, QA e uso;
- importação e integridade de storage ficam em uma tela operacional própria, sem poluir o catálogo.

## Gates

O checkpoint acompanha `docs/VALIDATION_REPORT_0_20.json`.

- Clean-zero data gate: PASS
- D1 integrity / FK: PASS
- Structural TypeScript — Core: PASS
- Structural TypeScript — Frontend: PASS
- MCP compatibility: PASS
- 0 erros no validador do checkpoint
- `next build` e Wrangler reais permanecem gates externos quando as dependências do registry/ambiente Cloudflare não estão instaladas.
