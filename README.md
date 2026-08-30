# Corvo Library V2 0.20.19 — D1 Safe Migration Executor

> Corrige o erro `D1_EXEC_ERROR ... incomplete input` no boot e impede replay automático de migrations históricas destrutivas em Libraries já operacionais.

Principais garantias:

- migrations do Worker são quebradas em statements SQL completos;
- execução em batch transacional via D1 prepared statements;
- comentários e SQL multilinha não são tratados como queries separadas;
- migrations históricas de reset `9008`, `9010`, `9011`, `9012` e `9013` são registradas como `SKIPPED_LEGACY_DESTRUCTIVE` no boot/update;
- nenhuma dessas migrations pode apagar assets/projetos ou agendar purge R2 durante atualização normal;
- migration aditiva `9018_v2_safe_live_migration_executor.sql` recria apenas estruturas seguras necessárias;
- schema contract final `2.18.0`;
- Core/Worker `0.20.19`;
- fila, FAST PUSH, QA, MCP público e correções anteriores preservados.
