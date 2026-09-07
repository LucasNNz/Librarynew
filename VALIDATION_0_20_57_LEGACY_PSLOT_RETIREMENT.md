# Validation — 0.20.57 Legacy PSLOT Retirement

- TypeScript App: PASS
- TypeScript Core: PASS
- Behavior gate 0.20.57: 14/14 PASS
- Migration/query-plan regression 2.27.0: PASS (14/14)
- QA finalize rollback regression: PASS (9/9)
- Simulação específica: 97 FROZEN + 1 PENDING legado -> 97 ativos/FROZEN + 1 RETIRED: PASS
- `automatic_project_items.qa_status` permanece NOT NULL durante a reconciliação: PASS
- Export/ZIP ignora PSLOT `RETIRED`: PASS
- Asset/R2 não é apagado ao aposentar PSLOT: PASS
- Schema: 2.27.0, sem migration nova
