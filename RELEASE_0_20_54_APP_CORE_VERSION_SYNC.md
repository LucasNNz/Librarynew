# Corvo Library V2 0.20.54 — App/Core Version Sync

## Objetivo
Tornar impossível confundir a versão do frontend com a versão realmente publicada no Worker Cloudflare.

## Mudanças
- Configurações mostra APP, CORE/WORKER e STATUS permanentemente.
- Divergência mostra `CORE DESATUALIZADO` e o botão `Atualizar Core agora`.
- A comparação de versões não depende de D1 saudável.
- Novo `GET /version` no Core: zero leitura D1/R2/Queue.
- `verificar_saude` agora expõe `core_version` e deixou de varrer `catalogStats`.
- Novo MCP `obter_versao_core` sem leitura D1.
- Auto-update no boot é preservado; o botão manual é fallback/controle explícito.
- Nenhuma migration nova; schema permanece 2.27.0.
