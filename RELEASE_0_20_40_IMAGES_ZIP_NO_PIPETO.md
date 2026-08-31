# Corvo Library V2 0.20.40 — PROJECT_IMAGES_ZIP sem pipeTo

## Escopo

Correção cirúrgica do `PROJECT_IMAGES_ZIP`, preservando parser 72/72, 102/102 production slots, FAST READ, tags persistentes e os três artefatos finais independentes.

## Correção principal

O caminho `PROJECT_IMAGES_ZIP` não usa mais `ReadableStream.pipeTo()`, `tee()`, `DigestStream` ou `FixedLengthStream`.

Fluxo novo:

1. resolve o tamanho de cada entrada via R2 HEAD;
2. calcula o tamanho exato do ZIP;
3. aloca um `Uint8Array` final com esse tamanho;
4. lê cada objeto R2 sequencialmente e grava diretamente no buffer final;
5. calcula CRC e diretório central durante a montagem;
6. valida o tamanho final;
7. calcula SHA-256 sobre os bytes finais;
8. executa `R2.put(key, Uint8Array)` com corpo de comprimento conhecido;
9. reabre o índice ZIP no R2 e valida nomes esperados;
10. persiste `READY_FOR_DOWNLOAD` somente após todas as validações.

O limite defensivo desta rota é 96 MiB por ZIP materializado. Acima disso a operação falha explicitamente com `PROJECT_IMAGES_ZIP_BUFFER_LIMIT_EXCEEDED`, sem retornar ao caminho de streaming antigo.

## Estado de falha

Ao iniciar/reprocessar o pacote, campos de payload antigos são limpos. Em falha final:

- `status = FAILED`;
- `error = erro real`;
- `r2_key = NULL`;
- `size_bytes = 0`;
- `sha256 = NULL`;
- `ready_at = NULL`.

A Queue recebe ACK para artefatos finais que já persistiram `FINAL_ARTIFACT_FAILED`, evitando retry que volte a colocar o pacote em `PROCESSING`.

## Telemetria nova

- `FINAL_IMAGES_ZIP_BYTES_READY`: ZIP montado integralmente em memória, antes do R2 PUT.
- `FINAL_IMAGES_ZIP_R2_VERIFIED`: R2 confirmou objeto com o tamanho esperado.
- Resultado final inclui `uploadMode = KNOWN_LENGTH_UINT8ARRAY_NO_PIPETO` e `pipeToUsed = false`.

## Smokes executados

- ZIP pequeno: PASS / `unzip -t` PASS.
- 102 entradas reutilizando um mesmo objeto físico: PASS.
- ZIP de 44.382.058 bytes: tamanho previsto == tamanho emitido.
- `pipeToUsed = false`.
- Parser sintético: 72 perguntas -> 72 cenas, `CENA-072` presente.

## Critério de pronto no runtime real

A correção só deve ser considerada operacionalmente encerrada quando o MCP real retornar:

- `status: READY_FOR_DOWNLOAD`;
- `size_bytes > 0`;
- `download_url != null`.
