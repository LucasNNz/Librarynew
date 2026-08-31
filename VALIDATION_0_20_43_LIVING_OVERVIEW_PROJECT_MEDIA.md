# Validação 0.20.43 — Living Overview + Project Profile Media

## Resultado
PASS nos gates executáveis do checkpoint fonte.

### Gates
- `npm run validate:structural` — PASS
  - Frontend TypeScript estrutural
  - Cloudflare Core TypeScript estrutural
- `python scripts/behavior-gate-0-20-43-living-overview.py` — PASS (23/23)
- `python scripts/behavior-gate-0-20-42-production-slot-rejection.py` — PASS
  - regressão da rejeição individual de PRODUCTION_SLOT preservada
- Schema D1 permanece `2.25.0`; nenhuma migration nova foi introduzida.

## Worker bundle
O checkpoint fonte não inclui `node_modules`, portanto o bundle esbuild não foi regenerado neste ambiente isolado.
Para impedir provisionamento acidental do bundle 0.20.42 anterior, `lib/generated-core-bundle.ts` é entregue como `UNBUILT`.

O fluxo normal de deploy executa `npm run build`; o lifecycle `prebuild` chama `scripts/build-core-bundle.mjs`, que agora lê a versão diretamente do `package.json` e gera/embute o Worker **0.20.43** depois que as dependências forem instaladas.

Isso é deliberadamente fail-safe: sem prebuild não é possível provisionar silenciosamente um Core antigo.
