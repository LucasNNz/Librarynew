# Validação 0.20.51 — Inline MCP QA Previews

## Gates

- TypeScript estrutural App: PASS
- TypeScript estrutural Core: PASS
- Behavior gate 0.20.51: PASS
- schema D1: 2.26.0, sem migration nova

## Contrato validado

`obter_production_slots_para_qa` retorna metadados textuais e `ImageContent` inline para cada PSLOT da página. Os bytes vêm diretamente de `env.MEDIA.get(r2_key)`; nenhuma requisição HTTP ao hostname público do Worker é necessária para o QA.

A URL assinada continua disponível somente como `diagnostic_preview_url`. O campo operacional `preview_url` é nulo no envelope da ferramenta para impedir que automações antigas tentem abrir o navegador como caminho principal.

A ferramenta declara explicitamente `browser_required=false` e `permission_required=false` e instrui o agente a nunca solicitar autorização de domínio ao usuário.
- regressão Signed Preview GET+HEAD 0.20.50 recompilada como smoke 0.20.51: PASS (`HEAD 200 / body 0`, `GET 200 / bytes preservados`)
