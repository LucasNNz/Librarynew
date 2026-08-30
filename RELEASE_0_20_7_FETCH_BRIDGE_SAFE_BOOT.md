# Corvo Library V2 0.20.7 — Fetch Bridge e boot seguro

## Correção definitiva de `Failed to fetch`

- chamadas `/api/*` do cliente passam por `/api/core-proxy/*` no mesmo domínio;
- o proxy aceita somente Workers `https://*.workers.dev` (e localhost apenas em desenvolvimento);
- a chave do app continua sendo validada pelo Core;
- falhas de rede passam a retornar `CORE_PROXY_UNREACHABLE` com status HTTP 502;
- respostas 401/4xx/5xx do Core são preservadas, em vez de virarem erro opaco de CORS.

## Proteção de dados

- o carregamento inicial consulta somente health, stats, universos, assets,
  projetos e operações;
- nenhuma migration é executada ao abrir a interface;
- `/bootstrap` do Core também ficou somente leitura;
- a migration `9014` foi neutralizada e agora registra apenas metadados de
  schema, sem `DELETE` em tabelas operacionais.

## Verificações

- TypeScript do frontend: PASS;
- build Next.js de produção: PASS;
- proxy autenticado com Core simulado: PASS;
- chave inválida preserva HTTP 401: PASS;
- destino externo não permitido retorna HTTP 400: PASS.
