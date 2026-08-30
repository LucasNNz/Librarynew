# Validation — Corvo Library V2 0.20.25

Resultado geral: **PASS — 0 erros**.

## Gates
- Frontend TypeScript: PASS
- Worker TypeScript: PASS
- Worker embutido: 0.20.25
- Worker embutido `node --check`: PASS
- migrations seguras: 9000 → 9019
- schema final: 2.19.0
- MCP: 256 ferramentas registradas, 256 únicas
- validator completo: PASS / 0 erros

## Teste comportamental — cena inexistente
Entrada simulada em banco migrado:
- projeto sem itens;
- `CENA-001`;
- `target_candidates=3`;
- `required_approved=1`;
- 4 candidatas.

Resultado:
- cena criada: 1;
- `QUEUED`: 3;
- `DISCOVERED` reserva: 1;
- `total_items`: 1;
- segunda tentativa de upsert da mesma cena: continua 1 item.

## Teste comportamental — lifecycle
- COMPLETE → `lifecycle_status=COMPLETED`, `mcp_locked=1`;
- REOPEN explícito → `lifecycle_status=ACTIVE`, `mcp_locked=0`.

## Observação
Build real do Next/Wrangler permanece gate externo no ambiente de validação porque as dependências/conta Cloudflare não estão provisionadas. O validator estrutural e o bundle embarcado passaram.
