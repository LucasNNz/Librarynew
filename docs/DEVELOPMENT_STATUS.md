# Development Status — Corvo Library V2 0.20.12

## Factory Zero

- assets: 0;
- universos derivados: 0;
- usos: 0;
- projetos e execuções: 0;
- importações/candidatas/históricos: 0;
- settings/fontes/perfis/políticas/capacidades recuperadas: 0;
- infraestrutura persistente D1/R2/Worker: preservada;
- schema: 2.13.0;
- foreign-key violations: 0.

A 0.20.3 não depende mais apenas de uma migration antiga: o boot executa um gate de release e chama o reset Factory Zero direto do Worker uma única vez, marcado por `factory_zero_release_0_20_3=DONE`. Isso remove registros residuais mesmo que uma limpeza anterior tenha sido marcada como aplicada sem produzir efeito no D1 vivo.

## R2

- o bucket/binding é preservado;
- apenas prefixes gerenciados pela Corvo são elegíveis para limpeza: `assets/`, `imports/`, `projects/`, `incoming/`, `batches/`, `exports/`, `corvo-core/recovery/`;
- a limpeza factory-zero não recria recovery manifest ao terminar;
- depois da primeira carga real, importação e reconciliação R2 ↔ D1 permanecem ativas.

## Importação

- múltiplos lotes ZIP pela UI: concluído;
- upload direto navegador → Worker/R2: concluído;
- teto de lote: 48 MiB;
- ID estável por SHA-256: concluído;
- deduplicação de reimportação: concluída;
- reconciliação R2 × D1: concluída.

## MCP

- botão visível `Configurações → Conectar MCP`;
- endpoint remoto pronto `https://<worker>.<subdominio>.workers.dev/mcp`;
- `/mcp` público e sem autenticação;
- ChatGPT deve ser configurado com autenticação **Nenhuma**;
- copiar link MCP puro, sem prefixos ou headers;
- nenhuma chave Bearer/OAuth é mostrada ou solicitada para o MCP;
- `CORVO_APP_KEY` permanece exclusiva das demais rotas internas do Core.

## Gates

- Validation checkpoint: PASS;
- Structural TypeScript — Core: PASS;
- Structural TypeScript — Frontend: PASS;
- MCP unique tools: 244;
- factory-zero migration smoke: PASS;
- erros: 0;
- `next build`: gate externo; registry npm expirou nesta execução;
- Wrangler/live Cloudflare: gate externo do ambiente implantado.
