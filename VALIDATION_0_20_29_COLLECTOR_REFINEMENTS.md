# Validation 0.20.29 — Collector Refinements

Status: **PASS**

## Gates executados

- TypeScript estrutural do Worker: PASS.
- TypeScript estrutural do app: PASS.
- `node --check` do Worker embutido: PASS.
- `validate-checkpoint.py`: PASS.
- Schema: `2.20.0` preservado; nenhuma migration destrutiva nova.
- MCP: 262 ferramentas únicas registradas; 0 duplicadas; 0 implementadas faltando registro.
- Bundle autoatualizável: versão `0.20.29`, sincronizado com o bundle validado.
- Contrato Queue: `LOW_LATENCY_CANDIDATE_V4`, batch 10, wait 0, autoscaling e fan-out paralelo.
- Contrato operacional: `status` histórico permanece independente de `goal_satisfied` / `collection_status`.
- Contrato semântico: `universo`, `sujeito`, `conceito`, `referencia` e `trecho_roteiro` chegam ao item/QA quando fornecidos.

## External gates

O build real Next e o build real Wrangler continuam classificados como **EXTERNAL_GATE** no validador autocontido porque dependências npm/conta Cloudflare não estão provisionadas neste ambiente. Isso não gerou erro estrutural no checkpoint.

## Observação sobre latência

A mudança de Queue restaura a configuração que favorece baixa latência, mas o checkpoint não declara uma latência real garantida. O objetivo de voltar à faixa observada anteriormente (~2,5 s de Queue) precisa ser confirmado depois do deploy no runtime Cloudflare.
