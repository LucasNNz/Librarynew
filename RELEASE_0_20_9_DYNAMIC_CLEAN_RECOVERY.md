# Corvo Library V2 0.20.9 — Dynamic Clean Recovery

## Causa corrigida

A migration 9015 da versão anterior continha `DELETE FROM` para uma lista fixa
de tabelas. D1s legados podem não ter todas elas; uma única tabela ausente fazia
o Worker lançar uma exceção e o boot parar.

## Fluxo novo

1. O frontend verifica a versão do Core.
2. Se necessário, publica o Core 0.20.9 e aguarda o Worker voltar.
3. Chama `POST /control/operational-clean-once`.
4. O Worker consulta `sqlite_master` e gera deletes somente para tabelas que
   realmente existem.
5. Preserva os manifestos de infraestrutura, registros de migration e secrets.
6. Confirma zero assets e zero projetos antes de liberar a interface.

A migration 9015 agora é apenas compatível e não contém deletes. Toda exceção
HTTP do Core é convertida em JSON com `CORE_REQUEST_FAILED` e detalhe, mantendo
CORS, em vez da página genérica de exceção da Cloudflare.
