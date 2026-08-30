# 0.20.20 — Health Shape Gate Fix

## Sintoma corrigido

`SCHEMA_GATE_FAILED:{}` durante o boot, mesmo com o Core/D1 operacionais.

## Causa

Com uma conexão persistida, `installCorvoFetchBridge()` transforma `/api/health` em `/api/core-proxy/health`. Essa rota devolve diretamente o payload do Worker:

```json
{"ok":true,"version":"0.20.19","schemaContract":{"ready":true}}
```

O gate 0.20.19 validava apenas o formato BFF:

```json
{"app":"ok","core":{"schemaContract":{"ready":true}}}
```

Assim, `schemaProbe.core` era `undefined` e o erro era serializado como `{}`.

## Correção

Foi introduzida normalização única de health (`unwrapCoreHealth`) utilizada por:

- boot autoritativo;
- verificação de versão do Core;
- schema gate após migrations;
- atualização manual do Core;
- estado de health da interface.

O gate agora aceita ambos os formatos sem relaxar o contrato de schema.

## Diagnóstico

Se o schema estiver realmente incompleto, a mensagem passa a incluir:

- status HTTP;
- versão do Core;
- estado D1;
- estado de schema;
- `schemaContract` completo;
- tabelas/colunas ausentes;
- erro do Core, se houver.

## Segurança

- nenhuma migration nova;
- nenhum DDL novo;
- nenhum reset de dados;
- nenhum purge R2;
- Core esperado permanece `0.20.19`.
