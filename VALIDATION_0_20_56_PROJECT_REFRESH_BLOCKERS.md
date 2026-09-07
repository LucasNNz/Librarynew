# Validation 0.20.56 — Project Refresh + Blocker Summary

- Behavior gate 0.20.56: **35/35 PASS**
- TypeScript estrutural App: **PASS**
- TypeScript estrutural Core: **PASS**
- Migration/query-plan gate 2.27.0: **14/14 PASS**
- CSS brace integrity: **PASS**
- Schema: **2.27.0**, sem migration nova

## Gates funcionais cobertos

- botão manual de atualização;
- probe por `state_version/not_modified`;
- ausência dos antigos timers de polling da tela de Projetos;
- rota HTTP curta no App e Core;
- nova rota MCP `obter_pendencias_projeto`;
- blockers de PENDING, RELINK_REQUIRED, ASSIGNED_FOR_QA e arquivos finais;
- thumbs/títulos opcionais;
- `production_slots_pending` exposto no snapshot;
- Coletor derivado de PSLOT em vez do target legado de candidatas;
- painel visual de pendências e próxima frente;
- versões App/Core em 0.20.56.
