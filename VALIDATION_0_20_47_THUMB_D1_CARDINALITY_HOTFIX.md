# Validação 0.20.47 — THUMB D1 Cardinality Hotfix

## Resultado

**PASS**

## Bug reproduzido e isolado

O INSERT compartilhado de `v2_project_media` possuía 16 colunas e 17 valores. A correção removeu o placeholder excedente.

## SQL smoke real

O SQL corrigido foi executado em SQLite com a estrutura de 16 colunas:

- colunas: **16**;
- placeholders: **13**;
- bindings: **13**;
- literais: **3**;
- linha criada como `THUMB / THUMB_CANDIDATE`, `selected=0` e `slot_index=1`: **PASS**.

## Behavior gate 0.20.47

**42/42 PASS**

Inclui toda a cobertura funcional da 0.20.46 e adiciona checks explícitos para:

- cardinalidade 16/16 do INSERT de THUMB;
- 13 placeholders / 13 bindings;
- execução real do SQL corrigido;
- uso do helper compartilhado `createProjectMediaFromCandidate`.

## Regressões

- 0.20.42 Production Slot Rejection: PASS;
- 0.20.43 Living Overview + Project Media: PASS;
- 0.20.44 Atomic PSLOT Rejection: PASS;
- 0.20.45 QA by Rejection: PASS;
- Migration 9026: PASS;
- SQL finalize QA / rollback: PASS.

## TypeScript estrutural

- App/Next source: PASS;
- Cloudflare Core source: PASS.

## Schema

Permanece **2.26.0**, sem migration 9027.
