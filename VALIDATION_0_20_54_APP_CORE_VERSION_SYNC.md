# Validation — 0.20.54 App/Core Version Sync

## Resultado

PASS.

- App TypeScript structural typecheck: PASS
- Core TypeScript structural typecheck: PASS
- Behavior gate 0.20.54: 31/31 PASS
- Migration/query-plan regression 9027: 14/14 PASS
- Schema: 2.27.0 (sem migration nova)

## Contrato validado

1. Configurações mostra APP, CORE/WORKER e STATUS permanentemente.
2. Versão divergente mostra `CORE DESATUALIZADO` e `Atualizar Core agora`.
3. A comparação não depende de `core.ok` nem de D1 saudável.
4. `GET /version` retorna a release do Worker sem consultar D1/R2/Queue.
5. `verificar_saude` sempre expõe `core_version` e não chama mais `catalogStats`.
6. MCP expõe `obter_versao_core` sem leitura D1.
7. Auto-update do boot permanece ativo; o botão é fallback manual explícito.
8. Se o Worker for atualizado enquanto D1 estiver bloqueado, a UI reconhece a versão nova e informa que a verificação/migration do D1 ficou pendente.
9. D1 Read Optimization 0.20.53, QA inline, upload local de thumb, workspace responsivo e publicação opcional permanecem preservados.
