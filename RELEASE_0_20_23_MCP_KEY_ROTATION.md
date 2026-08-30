# Release 0.20.23 — MCP Internal Key Rotation

## Objetivo

Adicionar no modal MCP um botão para revogar a chave administrativa atual da Corvo Library e gerar outra automaticamente, sem confundir essa chave com a autenticação do MCP público do ChatGPT.

## Comportamento

- `/mcp` permanece público e configurado no ChatGPT com autenticação `Nenhuma`.
- `CORVO_APP_KEY` continua protegendo as rotas operacionais/administrativas do Core.
- o botão `Revogar e gerar nova chave` chama `POST /control/rotate-app-key` usando a chave atual salva no navegador;
- o Worker gera 32 bytes aleatórios, grava a nova `CORVO_APP_KEY` como secret do Worker e retorna a nova chave apenas nessa resposta protegida;
- a interface salva a nova chave em `BrowserConnection`, substituindo a anterior;
- a chave nunca é mostrada no modal;
- após a rotação, o frontend faz probes com a nova conexão até confirmar que o Worker já aceitou a nova chave;
- a data/hora da última rotação realizada nessa sessão é mostrada no modal.

## Segurança

A rotação exige a chave administrativa atual porque `/control/rotate-app-key` continua atrás de `authorized()`. A rota pública `/mcp` não recebe acesso ao mecanismo de rotação.

## Compatibilidade

Core esperado permanece `0.20.22`, pois o endpoint de rotação já existe e está presente no bundle embutido. Schema permanece `2.18.0`. Nenhuma migration, cleanup ou alteração em R2/D1.
