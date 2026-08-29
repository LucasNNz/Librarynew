# Assistente de infraestrutura — Corvo Library V2 0.12

## Objetivo

A configuração normal acontece **inteiramente pela interface web**. O usuário não instala Wrangler/npm e não adiciona variáveis manualmente na hospedagem do frontend.

## Fluxo rápido

1. Abra **Configurações → Configurar agora**.
2. Crie/cole um **Cloudflare API Token** com permissões de conta suficientes para Workers Scripts, D1, R2 e Queues.
3. Se houver mais de uma conta Cloudflare, escolha a conta mostrada pelo próprio app.
4. Clique **Configurar tudo automaticamente**.
5. Aguarde os estados D1, R2, Queue e Controle ficarem `ok`.
6. O manifesto é salvo como `LOCKED` automaticamente.

## O que o app faz

- D1: encontra ou cria `corvo-library-v2`.
- R2: exige o bucket existente `corvoquiz-prod`; não cria outro bucket silenciosamente.
- Queue: encontra ou cria `corvo-materialize-v2`.
- DLQ: encontra ou cria `corvo-materialize-v2-dlq`.
- Worker: publica `corvo-core-v2` com bindings nativos.
- banco: se estiver vazio, usa o dump histórico embutido no pacote e aplica migrations V2; se já estiver inicializado, preserva os dados.
- secrets: gera chaves internas e move o token Cloudflare para secrets do Worker.
- navegador: salva a conexão de aplicação para as próximas aberturas.
- D1: grava somente nomes/IDs não secretos e a revisão do manifesto.

## Persistência

O manifesto nasce `LOCKED`. Atualizações do frontend, reinícios e novos deploys não alteram esse perfil. O botão **Alterar configuração** é o único caminho normal para mudar recursos; uma alteração cria uma nova revisão auditável.

Se o navegador perder seu armazenamento local, a infraestrutura não é apagada. Reabra o setup, informe um token Cloudflare e o app redetectará D1/R2/Queue/Worker. O banco já inicializado é preservado.

## Segurança

Não entram no D1:

- API Token Cloudflare;
- R2 Access Key ID;
- R2 Secret Access Key;
- `CORVO_INTERNAL_KEY`;
- `CORVO_APP_KEY`;
- `CORVO_SIGNING_KEY`.

O Worker acessa o R2 pelo binding `MEDIA`, portanto o fluxo normal não precisa de credenciais S3 do R2.
