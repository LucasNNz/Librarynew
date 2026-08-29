# Corvo Library V2

Reconstrução limpa da Corvo Library com **Vercel (UI/BFF)** + **Cloudflare Worker (Core)** + **D1 + R2 + Queue**.

A V2 usa a V61.9 somente como referência funcional. Não carrega Turso/libSQL, `production-recovery`, `secret_cloudflare_connection` nem credenciais R2 salvas no banco.

## Estrutura

- `/app` — Next.js para Vercel.
- `/lib` — contratos e cliente BFF → Core.
- `/cloudflare` — Worker Core, MCP stateless, D1, R2 e Queue.
- `/cloudflare/migrations/9000_v2_core.sql` — apenas extensões `v2_*`.
- `/scripts/prepare-d1-import.mjs` — prepara o dump histórico para restauração 1:1 no D1 novo.
- `/docs/ARCHITECTURE.md` — decisões arquiteturais.
- `/docs/DATA_STRATEGY.md` — estratégia de dados sem conversão.
- `/docs/MCP_COMPATIBILITY_MATRIX.md` — matriz das 229 ferramentas históricas.

## Vercel

Configure somente:

```env
CORVO_CORE_URL=https://<worker>.workers.dev
CORVO_INTERNAL_KEY=<mesma-chave-do-worker>
NEXT_PUBLIC_CORVO_ENV=production
```

Nenhuma chave do R2 deve existir no frontend ou no projeto Vercel.

## Cloudflare Core

1. Criar o D1 `corvo-library-v2`.
2. Reutilizar o bucket existente `corvoquiz-prod` via binding `MEDIA`.
3. Criar `corvo-materialize-v2` e a DLQ `corvo-materialize-v2-dlq`.
4. Copiar `cloudflare/wrangler.jsonc.example` para `cloudflare/wrangler.jsonc` e preencher apenas os IDs de recursos.
5. Gravar `CORVO_INTERNAL_KEY` como secret do Worker.
6. Restaurar o dump histórico preparado.
7. Aplicar `cloudflare/migrations/9000_v2_core.sql`.
8. Publicar o Worker e depois apontar a Vercel para ele.

## Restauração sem conversão

```bash
node scripts/prepare-d1-import.mjs database.sql CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql
cd cloudflare
npx wrangler d1 execute CORVO_DB --remote --file=../CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql --config wrangler.jsonc
npx wrangler d1 migrations apply CORVO_DB --remote --config wrangler.jsonc
```

O script remove somente wrappers de transação incompatíveis com import remoto e as três configurações históricas de segredo que já vieram redigidas no backup. IDs, `r2_key`, status e demais registros permanecem no modelo histórico.

## FAST PUSH V2

`URL → ACK operationId → Queue → materialização → R2 → D1 → Inbox → aprovação`

O MCP nunca precisa baixar o binário quando recebe uma URL.
