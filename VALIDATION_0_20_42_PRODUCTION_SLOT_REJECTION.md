# Validação 0.20.42 — Production Slot Rejection

Resultado: **PASS**

- schema D1: `2.25.0`
- frontend estrutural: PASS
- Worker estrutural: PASS
- MCP: 293 registradas / 293 únicas / 0 duplicadas
- behavior gate PSLOT: PASS
- bundle gate: PASS
- Worker embutido reextraído: `node --check` PASS

O gate cobre rejeição isolada A/B, preservação dos ASTs, decremento/incremento exato das contagens, histórico REJECTED/RELINKED, export antigo preservado porém STALE, elegibilidade do gap para Coletor, limite 500 e idempotência forte de `operation_id` após relink.

Build Next/Wrangler real permanece external gate por depender de dependências/ambiente Cloudflare externos.
