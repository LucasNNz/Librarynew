# Assistente de infraestrutura — Corvo Library V2 0.20.13

## Objetivo

A configuração normal acontece **inteiramente pela interface web**. O usuário não instala Wrangler/npm e não adiciona variáveis manualmente na hospedagem do frontend.

## Fluxo rápido

1. Abra **Configurações → Configurar agora**.
2. Crie/cole um **Cloudflare API Token** com permissões para Workers Scripts, D1, R2 e Queues.
3. Se necessário, informe o Account ID.
4. Clique **Configurar tudo automaticamente**.
5. Aguarde D1, R2, Queue e Controle ficarem `ok`.
6. O manifesto é salvo como `LOCKED` automaticamente.

## Estado 0.20.3

A atualização 0.20.3 aplica uma única migration **FACTORY_ZERO** para remover qualquer catálogo/histórico recuperado que ainda exista no D1. Ela preserva o perfil de infraestrutura e o bucket R2; depois desse reset, novos assets entram somente por importação/coleta real.

## O que o app faz

- D1: encontra ou cria `corvo-library-v2`.
- R2: exige o bucket existente `corvoquiz-prod`; não cria outro bucket silenciosamente.
- Queue: encontra ou cria `corvo-materialize-v2`.
- DLQ: encontra ou cria `corvo-materialize-v2-dlq`.
- Worker: publica `corvo-core-v2` com bindings nativos.
- banco: aplica migrations registradas sem restaurar conteúdo histórico.
- secrets: gera chaves internas e move o token Cloudflare para secrets do Worker.
- navegador: salva a conexão de aplicação para as próximas aberturas.
- D1: grava somente nomes/IDs não secretos e a revisão do manifesto.

## Conectar MCP ao GPT

Abra **Configurações → Conectar MCP**. A tela mostra:

- URL MCP pública pronta: `https://<worker>.<subdominio>.workers.dev/mcp`;
- autenticação no ChatGPT: **Nenhuma**;
- botão **Copiar link MCP**;
- botão **Copiar para ChatGPT**.

O endpoint `/mcp` é público de propósito para o app personalizado do ChatGPT. `CORVO_APP_KEY` continua existindo apenas para proteger as demais rotas operacionais do Core e não deve ser informada ao ChatGPT.

## Persistência

O manifesto nasce `LOCKED`. Atualizações do frontend, reinícios e novos deploys não alteram esse perfil. O botão **Alterar configuração** é o caminho normal para mudar recursos; uma alteração cria nova revisão auditável.

## Segurança

Não entram no D1:

- API Token Cloudflare;
- R2 Access Key ID;
- R2 Secret Access Key;
- `CORVO_INTERNAL_KEY`;
- `CORVO_APP_KEY`;
- `CORVO_SIGNING_KEY`.

O Worker acessa o R2 pelo binding `MEDIA`, portanto o fluxo normal não precisa de credenciais S3 do R2.
