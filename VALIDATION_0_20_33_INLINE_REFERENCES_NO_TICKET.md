# VALIDATION 0.20.33 — Inline References No-Ticket

## Resultado

**PASS** nos gates autocontidos.

## Gates

- TypeScript estrutural frontend: PASS.
- TypeScript estrutural Worker: PASS.
- Migrações D1 sobre baseline limpo: PASS.
- `PRAGMA integrity_check`: `ok`.
- Schema final: **2.21.0**.
- MCP: **272 ferramentas registradas / 272 únicas / 0 duplicadas**.
- `anexar_referencias_projeto`: presente no fonte e no Worker embutido.
- `obter_referencias_projeto`: presente no fonte e no Worker embutido.
- hard gate `REFERENCES_USE_INLINE_MCP`: presente no fonte e no Worker embutido.
- `anexar_arquivo_projeto` não gera ticket para roles textuais de Referências.
- persistência inline R2 + D1: coberta pelo behavior gate.
- slot `reference` explicitamente aberto e resposta `READY`: cobertos pelo behavior gate.
- retorno copiável + preview + download: coberto pelo behavior gate.
- reparo idempotente de objeto R2 ausente: coberto pelo behavior gate.
- endpoint `POST /projects/:projectId/references/inline`: presente no fonte e no Worker embutido.
- Behavior Gate `INLINE_REFERENCES_NO_TICKET`: **16/16 PASS**.
- Worker embutido extraído: `node --check` PASS.

## Correção adicional no Worker embutido

O bundle herdado do 0.20.32 continha duas declarações de `approveOne` no mesmo escopo por causa do overlay de `target_file`, o que fazia `node --check` falhar. No 0.20.33 a implementação antiga foi renomeada internamente para `approveOneLegacy`, preservando a implementação 0.20.32 mais nova como `approveOne` usada pelos chamadores. O Worker embutido final passa em verificação sintática.

## Gates externos

Build real Next e deploy/build Wrangler permanecem **EXTERNAL_GATE** porque dependências npm e conta Cloudflare não estão provisionadas neste ambiente.
