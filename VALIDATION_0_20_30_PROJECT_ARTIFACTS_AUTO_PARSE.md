# Validation 0.20.30 — Project Artifacts + SCRIPT Auto Parse

## Gates

- checkpoint validator: **PASS**;
- Worker structural TypeScript: **PASS**;
- frontend structural TypeScript: **PASS**;
- MCP: **264 registradas / 264 únicas / 0 duplicadas / 0 faltantes**;
- imports relativos: **PASS**;
- D1 baseline + migrations: **PASS**;
- Worker embutido: `node --check` **PASS**;
- parser de cenas compilado isoladamente com TypeScript: **PASS**;
- teste `CENA-001` + `[CENA 002]`: **2 cenas**;
- teste `[01]` + `[02]`: **2 cenas**.

## Contratos verificados

- `PROJECT_FILE` toca `state_version` no commit D1;
- candidata do Coletor toca `state_version` quando materializada;
- aprovação e rejeição ligadas ao projeto também tocam `state_version`;
- snapshot incremental contém resumo de anexos;
- MCP contém `listar_arquivos_projeto` e `listar_artefatos_projeto`;
- SCRIPT inline e PROJECT_FILE/SCRIPT de upload direto disparam auto-parse;
- reconciliador possui recuperação de SCRIPT persistido + `0` itens;
- interface contém área `Arquivos e artefatos`, preview e download individual.

## External gates

O build real Next/Wrangler permanece como gate externo neste ambiente porque as dependências npm não estão instaladas e o registry não respondeu durante esta execução. Isso não alterou os typechecks estruturais nem a validação autocontida do checkpoint.
