# Corvo Library V2 0.20.14 — Asset Export Download Route

## Correção

O roteamento público de download usava `pathname.startsWith("/asset-exports/")`.
Isso fazia a rota `/asset-exports/{id}/link` ser tratada como se fosse o arquivo
ZIP assinado. Como `/link` não contém `exp`/`sig`, o Worker respondia `403 Forbidden`
em texto, e o frontend quebrava ao executar `response.json()`.

Agora:

- o arquivo público assinado casa apenas `^/asset-exports/[^/]+$`;
- `/asset-exports/{id}/link` alcança a rota autenticada correta;
- o frontend aceita JSON ou texto e exibe o erro real;
- URLs assinadas do arquivo final continuam públicas durante o TTL;
- nenhuma migration ou mudança de schema foi adicionada.

## Preservado

- fila de múltiplos ZIPs;
- upload R2 com comprimento conhecido;
- MCP do ChatGPT público e sem autenticação;
- autenticação das demais rotas do Core.
