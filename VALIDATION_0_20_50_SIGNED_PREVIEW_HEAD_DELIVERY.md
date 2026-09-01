# Validação 0.20.50 — Signed Preview HEAD Delivery

- TypeScript estrutural frontend: PASS
- TypeScript estrutural Cloudflare Core: PASS
- Behavior gate 0.20.50: 36/36 PASS
- Smoke `publicMediaResponse`: PASS
  - HEAD status: 200
  - HEAD body: 0 bytes
  - HEAD content-type: image/png
  - GET status: 200
  - GET body: preservado
- Prefixos assinados conferidos com o roteador:
  - `/candidate-files/` = 17 caracteres
  - `/thumbs/` = 8 caracteres
- Schema: 2.26.0 (sem migration)

## Teste recomendado pós-deploy

1. chamar `obter_production_slots_para_qa` para obter um `preview_url`;
2. chamar `testar_url(preview_url)` — deve retornar HTTP 200 e `image/*`;
3. abrir o mesmo URL por GET — deve entregar os pixels;
4. repetir com um AST via `/thumbs/:assetId`.

Os headers `x-corvo-public-media-route` e `x-corvo-core-version` permitem confirmar que a resposta veio do handler correto da 0.20.50.
