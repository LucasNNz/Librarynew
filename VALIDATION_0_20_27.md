# Validation 0.20.27 — Project Slot Customization

Resultado: **PASS — 0 erros**.

## Gates
- schema final: **2.20.0**;
- migration `9020_v2_project_slot_customization.sql`: aplicada pelo validator;
- Frontend TypeScript: PASS;
- Worker TypeScript: PASS;
- MCP: **261 ferramentas registradas / 261 únicas**;
- novas ferramentas de slot: 5/5 presentes;
- Worker embutido: versão **0.20.27** e `node --check` PASS;
- rotas HTTP de slot: access, text, image, asset e package presentes;
- seleção múltipla e exclusão permanente: presentes na UI;
- ações manuais por slot e abertura para MCP: presentes na UI;
- lifecycle lock preservado;
- vínculo de AST aprovado idempotente;
- candidata já vinculada a outro projeto não é reassociada silenciosamente.

## Ferramentas MCP novas
- `configurar_slot_projeto`
- `obter_slots_abertos_projeto`
- `preencher_slot_imagem_projeto`
- `preencher_slot_texto_projeto`
- `vincular_asset_slot_projeto`

Nenhuma limpeza destrutiva de D1/R2 foi adicionada.
