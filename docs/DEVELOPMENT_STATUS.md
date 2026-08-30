# Development Status — Corvo Library V2 0.20.2

## Factory Zero

- assets: 0;
- universos derivados: 0;
- usos: 0;
- projetos e execuções: 0;
- importações/candidatas/históricos: 0;
- settings/fontes/perfis/políticas/capacidades recuperadas: 0;
- infraestrutura persistente D1/R2/Worker: preservada;
- schema: 2.12.0;
- foreign-key violations: 0.

A migration `9012_v2_factory_zero_assets.sql` roda também sobre uma instalação 0.20/0.20.1 já publicada, portanto remove registros que tenham permanecido no D1 vivo mesmo quando migrações de limpeza anteriores já estavam marcadas como aplicadas.

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
- endpoint pronto `${coreUrl}/mcp`;
- copiar link MCP;
- copiar chave Bearer;
- copiar bloco completo para GPT;
- mostrar/ocultar chave;
- `Revogar e gerar nova`: substitui `CORVO_APP_KEY` no Worker e salva a nova chave no navegador;
- chave MCP nunca é persistida no D1.

## Gates

- Validation checkpoint: PASS;
- Structural TypeScript — Core: PASS;
- Structural TypeScript — Frontend: PASS;
- MCP unique tools: 244;
- factory-zero migration smoke: PASS;
- erros: 0;
- `next build`: gate externo; registry npm expirou nesta execução;
- Wrangler/live Cloudflare: gate externo do ambiente implantado.
