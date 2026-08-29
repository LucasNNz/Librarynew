# Runbook de implantação — Corvo Library V2

A implantação é deliberadamente dividida em **Core Cloudflare** e **UI/BFF Vercel**. Nenhuma credencial R2 é copiada para o app.

## 1. Gates locais obrigatórios

```bash
# na raiz
python scripts/validate-checkpoint.py /caminho/CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql

# com dependências instaladas
npm ci
npm run build
cd cloudflare
npm ci
npm run typecheck
```

O gate Python separa inconsistências históricas preservadas de regressões V2. O build Next.js e o typecheck com os tipos reais de Wrangler continuam obrigatórios antes do corte.

## 2. Provisionar Cloudflare

```bash
cd cloudflare
npx wrangler whoami
npx wrangler d1 create corvo-library-v2
npx wrangler queues create corvo-materialize-v2
npx wrangler queues create corvo-materialize-v2-dlq
```

Obtenha o UUID de `corvo-library-v2` e, a partir da raiz:

```bash
node scripts/render-wrangler.mjs <D1_DATABASE_ID>
```

O arquivo gerado vincula:

- `DB` → D1 `corvo-library-v2`
- `MEDIA` → bucket existente `corvoquiz-prod`
- `MATERIALIZE_QUEUE` → `corvo-materialize-v2`
- DLQ → `corvo-materialize-v2-dlq`

## 3. Secrets do Worker

Gere **duas chaves diferentes**. `CORVO_INTERNAL_KEY` autentica Vercel/MCP → Worker; `CORVO_SIGNING_KEY` existe somente no Worker e assina URLs temporárias.

```bash
cd cloudflare
npx wrangler secret put CORVO_INTERNAL_KEY
npx wrangler secret put CORVO_SIGNING_KEY
```

Nunca grave essas chaves em D1, Git ou no frontend.

## 4. Restaurar D1

Primeiro carregue o dump histórico sanitizado preparado pelo gate:

```bash
cd cloudflare
npx wrangler d1 execute corvo-library-v2 --remote --file /caminho/CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql --config wrangler.jsonc
```

Depois aplique apenas as migrations aditivas V2:

```bash
npx wrangler d1 migrations apply corvo-library-v2 --remote --config wrangler.jsonc
```

Nenhuma migration V2 converte ou recria as 47 tabelas históricas.

## 5. Publicar Core e validar

```bash
npm run deploy
```

Verifique `/health` e `/data-health` usando `x-corvo-internal-key`. O corte só pode seguir quando:

- D1 = `ok`
- R2 = `ok`
- schema = `ok`
- signing = `ok`
- `v2Orphans = 0`
- assets sem `r2_key = 0`

As orfandades históricas registradas em `HISTORICAL_INTEGRITY_BASELINE.json` não são apagadas; dispatcher e Supervisor V2 ignoram essas linhas.

## 6. Vercel separado

Projeto: `corvo-library-v2`.

Variáveis **server-side**:

```env
CORVO_CORE_URL=https://<corvo-core-v2>.workers.dev
CORVO_INTERNAL_KEY=<mesma-chave-interna-do-worker>
```

`CORVO_SIGNING_KEY` **não** vai para a Vercel.

Publique Preview primeiro, valide Catálogo → R2 → FAST PUSH → Inbox → aprovação → download e somente então promova para Production.

## 7. Teste de redeploy

Após o primeiro PASS de produção:

1. faça um novo deploy do frontend sem alterar Cloudflare;
2. confirme que catálogo/imagens continuam disponíveis;
3. faça um novo deploy do Worker sem alterar bindings;
4. confirme novamente `/health`, `/data-health` e FAST PUSH;
5. confirme que nenhuma tela pede Account ID/Access Key/Secret do R2.
