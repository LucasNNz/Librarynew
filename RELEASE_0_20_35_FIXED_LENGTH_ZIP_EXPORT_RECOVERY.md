# RELEASE 0.20.35 — FIXED-LENGTH ZIP EXPORT RECOVERY

## Problema corrigido

O exportador de projeto e o exportador genérico de assets entregavam um `ReadableStream` comum diretamente ao `R2.put()`. No runtime Cloudflare isso podia falhar com:

`Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)`

A falha era de infraestrutura de empacotamento, não de coleta, QA, manifesto ou production slots.

## Correção

1. O Worker faz `HEAD` de cada objeto R2 único que entrará no ZIP.
2. O tamanho exato do ZIP STORE é calculado antes do upload, incluindo headers locais, data descriptors, central directory e EOCD.
3. O stream ZIP é canalizado por `FixedLengthStream(expectedSize)`.
4. O lado `readable` do `FixedLengthStream` é entregue ao `R2.put()`.
5. O tamanho final gravado no R2 é comparado com `expectedSize` antes do pacote virar `READY_FOR_DOWNLOAD`.
6. A correção vale para `PROJECT_PRODUCTION_ZIP` e para `EXPORT_ASSETS`.

## Estado do projeto em caso de falha

Falhas de infraestrutura de ZIP:

- limpam `DOWNLOADER_WORKING` automaticamente;
- registram `PACKAGE_EXPORT_BLOCKED`;
- deixam `status/pipeline_status = PACKAGE_BLOCKED_INFRASTRUCTURE`;
- definem `next_action = CORRIGIR_EXPORTADOR_ZIP_FIXED_LENGTH_STREAM`.

Quando a geração passa, o Worker registra `PACKAGE_EXPORT_READY`, limpa o estado de downloader e chama a reconciliação do projeto. Nenhuma etapa de coleta, QA, rotação, cena ou production slot precisa ser refeita: o ZIP é regenerado diretamente do estado persistido.

## Compatibilidade

- Schema D1 permanece `2.21.0`.
- O manifesto slot → asset e a relação AST 1:N production slots permanecem intactos.
- Nenhuma duplicação de bytes é introduzida no R2; a repetição só acontece logicamente dentro do ZIP quando vários `target_file` usam o mesmo AST.
