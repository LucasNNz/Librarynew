# Release 0.20.62 — Quiz Browser Run Executor

Esta release corrige apenas a camada executora do Quiz no Core, preservando o fluxo 0.20.61 (catálogo/ciclo do Roteiro, Coletor, QA → Quiz, payload e idempotência).

## Correções

- Corrige o protocolo do binding `BROWSER` para os endpoints internos atuais do Cloudflare Browser Run:
  - `GET https://fake.host/v1/limits`
  - `POST https://fake.host/v1/devtools/browser?keep_alive=600000`
  - WebSocket `https://fake.host/v1/devtools/browser/{sessionId}`
- Remove dependência dos endpoints legados/incorretos `https://cloudflare.browser/...`.
- Usa CDP padrão em WebSocket browser-level com `Target.createTarget` + `Target.attachToTarget(flatten=true)`.
- Mantém o bridge do Quiz para resolver assets e subir PNG/MP4 no Core/R2.
- Envia heartbeat durante renders longos para manter:
  - a sessão Browser Run ativa;
  - o lease D1 do job ativo;
  - `quiz_executors.seen_at` atualizado.
- Fecha target/browser em `finally`, reduzindo consumo de Browser Run em falhas.
- `rendererStatus` agora valida o binding pelo endpoint `/v1/limits` correto e expõe diagnóstico aditivo (`provider`, `binding`, `limits`/`error`).
- O renderizador continua independente do navegador pessoal: `browser_closed_ok=true` quando o binding Browser Run está saudável.

## Sem mudança de schema

Schema permanece `2.29.0`; nenhuma migration D1 nova é necessária.
