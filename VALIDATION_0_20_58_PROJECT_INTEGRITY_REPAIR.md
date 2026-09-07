# Validation — 0.20.58 Project Integrity Repair

## Resultado

- TypeScript frontend estrutural: PASS
- TypeScript Core estrutural: PASS
- behavior gate 0.20.58: 26/26 PASS
- atomic PSLOT rejection regression 0.20.44: PASS
- migration/query-plan 9027 regression: 14/14 PASS
- schema: 2.27.0, sem migration nova

## Casos simulados

### UNIQUE histórico COMPLETED

Uma linha `PROJECT_ITEM / I1 / DISCOVERY = COMPLETED` permanece intacta. O trabalho necessário seguinte é criado como `PROJECT_ITEM_REVISION / I1:SV7:DISCOVERY`, sem colidir com a constraint estrita.

### UNIQUE histórico CANCELLED

Uma linha `PROJECT_ITEM / I2 / RELINK = CANCELLED` é reutilizada e volta a READY, em vez de executar novo INSERT.

### PSLOT obsoleto

Um FROZEN válido permanece intacto enquanto um target legado é marcado RETIRED. O PITEM legado recebe `qa_status=RETIRED`, nunca NULL.

## Observação sobre conflitos físicos

Em instalações onde a constraint estrita já está ativa, duplicatas físicas exatas normalmente não conseguem nascer. A ferramenta também cobre bancos/restores legados: o registro canônico é preservado e o duplicado é mantido como histórico CANCELLED com `scope_id` arquivado (`#SUPERSEDED#...`), nunca DELETE.
