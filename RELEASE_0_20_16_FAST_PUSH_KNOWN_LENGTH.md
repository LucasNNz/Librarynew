# Corvo Library V2 0.20.16 — FAST PUSH Known-Length R2

## Correção

O materializador de URLs do FAST PUSH não envia mais `ReadableStream` remoto diretamente ao R2.
O download é limitado a 30 MB, materializado em `Uint8Array` e somente então gravado no R2 com tamanho conhecido.

Fluxo novo:

`fetch remoto → stream limitado → Uint8Array conhecido → R2.put → D1 MATERIALIZED`

Isso elimina `Provided readable stream must have a known length` no caminho MCP/FAST PUSH.

## Versionamento do Core

O Worker, bundle embutido e `EXPECTED_CORE_VERSION` passam a `0.20.16`, garantindo que a publicação da Library detecte e aplique a atualização do Core em vez de considerar o antigo 0.20.13 como atual.

## Preservado

- importação em fila de múltiplos ZIPs;
- upload R2 conhecido do 0.20.13;
- download de exports do 0.20.14;
- CLEAN_ZERO one-shot do 0.20.15;
- MCP público sem autenticação;
- nenhuma migration nova;
- nenhum asset existente é apagado.
