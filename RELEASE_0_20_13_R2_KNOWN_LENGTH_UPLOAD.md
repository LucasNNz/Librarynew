# Corvo Library V2 0.20.13 — R2 Known-Length Upload

Correção focada no upload direto usado pela importação de lotes ZIP.

## Sintoma corrigido

`CORE_REQUEST_FAILED: Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)`

## Causa

`receiveDirectUpload()` envolvia `request.body` em `limitedStream()`. Esse `TransformStream` removia a informação de comprimento conhecida pelo runtime da Cloudflare. O R2 recusava esse corpo antes de armazenar o ZIP.

## Correção

- Se `Content-Length` está disponível e dentro do limite, o Worker envia o `request.body` original diretamente ao R2.
- Se o comprimento não está disponível, o Worker lê o stream com limite rígido, monta um `Uint8Array` e grava um corpo de tamanho explícito.
- O limite de 48 MB para lotes ZIP permanece.
- A fila de importação do 0.20.11 permanece.
- O MCP público sem autenticação do 0.20.12 permanece.
- Nenhuma migration nova.

## Gates

- Frontend structural TypeScript: PASS
- Worker structural TypeScript: PASS
- Worker embedded bundle syntax: PASS
- Direct upload no longer uses `limitedStream(request.body, maxBytes)`: PASS
- Unknown-length fallback remains bounded by `maxBytes`: PASS
- Import Queue `PROCESS_IMPORT_ZIP`: PRESENT
- Public `/mcp` before Core authentication gate: PRESENT
