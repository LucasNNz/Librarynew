# VALIDATION 0.20.32 — MCP3 Production Pipeline

## Resultado
**PASS** para os gates autocontidos do checkpoint.

## Gates executados
- TypeScript estrutural do frontend: PASS.
- TypeScript estrutural do Worker: PASS.
- Migrações D1 sobre baseline limpo: PASS.
- `PRAGMA integrity_check`: `ok`.
- Schema final: **2.21.0**.
- Tabelas V2 de produção presentes: `v2_reference_pools`, `v2_production_scenes`, `v2_production_slots`.
- MCP: **272 ferramentas registradas / 272 únicas / 0 duplicadas**.
- Imports relativos ausentes: 0.
- Worker embutido: versão 0.20.32 e `node --check` PASS.
- Worker embutido reextraído é byte a byte idêntico ao bundle 0.20.32 validado.
- Behavior gate MCP3 Production Pipeline: **15/15 PASS**.
- Parser smoke sintético: **72 cenas / 102 production slots**.

## Behavior gate coberto
- separação REFERENCE_POOL / PRODUCTION_SCENE / PRODUCTION_SLOT;
- `target_file` único por projeto+versão;
- SCRIPT → cenas/slots e preservação de metadados;
- `assign_assets_to_slots` até 500;
- associação lógica sem cópia R2 e AST 1:N slots;
- upsert por `target_file`;
- ZIP guiado por manifesto de production slots;
- nenhuma deduplicação lógica por `asset_id` no ZIP de produção;
- conclusão global por production slots + pacote requerido;
- QA ACK assíncrono + chunks de 10;
- ferramentas MCP de produção presentes uma única vez no Worker embutido.

## Gates externos
O build real Next e o build/deploy Wrangler continuam como **EXTERNAL_GATE** nesta execução, pois as dependências npm/conta Cloudflare não foram provisionadas e o registry não respondeu. Isso não foi tratado como PASS de deploy.
