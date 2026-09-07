# Validation 0.20.55 — Auth Recovery + Settings Bypass

- TypeScript estrutural App + Core: PASS
- Behavior gate 0.20.55: 26/26 PASS
- Device-token smoke: PASS (`deviceToken=true`, `legacy=true`, `bad=false`, `pair=true`)
- Configurações renderiza sem `releaseGateState=done`: PASS
- `/version` e `/control/pair-browser` estão antes do auth global: PASS
- recovery route não consulta D1: PASS
- recovery route não rotaciona APP/INTERNAL/SIGNING secrets: PASS
- existing-worker setup usa `keep_bindings`: PASS
- source checkpoint mantém Core bundle `UNBUILT` para impedir deploy de bundle antigo: PASS
