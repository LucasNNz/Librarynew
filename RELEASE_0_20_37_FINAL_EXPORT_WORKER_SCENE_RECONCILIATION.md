# Release 0.20.37 — Final Export Worker + Scene Reconciliation

## Escopo

Correção pontual sobre 0.20.36. Não altera a arquitetura dos 3 downloads, não reabre coleta/QA e não recria os 102 production slots resolvidos.

## Corrigido

1. `PROJECT_SCRIPT_TXT` e `PROJECT_IMAGES_ZIP` não precisam mais executar `materializeProductionModel` completo quando `questions_script != production_scenes_total`.
2. O drift de cenas usa `PRODUCTION_SCENES_FAST_RECONCILED`: upsert em lote somente das cenas e reparo de `scene_id` dos slots existentes.
3. Parser possui fallback por prefixo numérico do target (`061-...`, `072-...`) para recuperar blocos cuja sintaxe de cabeçalho não foi reconhecida.
4. `QUEUED/PROCESSING` parado por >= 90 s pode ser reenfileirado pelo mesmo `PKG-*` / operação.
5. Preflight dos targets do `imagens.zip` trabalha com concorrência 10 em vez de R2 serial, mantendo ordem determinística do ZIP.

## Preservado

- 3 artefatos independentes;
- `FixedLengthStream` nos ZIPs;
- 102/102 slots e AST 1:N;
- exportação a partir do estado persistido;
- schema D1 2.22.0;
- thumbs/publicação independentes.

## Gating

- TypeScript estrutural frontend: PASS
- TypeScript estrutural Worker: PASS
- D1 integrity/schema 2.22.0: PASS
- MCP: 277 registradas / 277 únicas / 0 duplicadas
- Parser smoke: 72 normal; 64 + 8 fallback = 72
- Behavior gate 0.20.37: PASS
- Worker embutido `node --check`: PASS
