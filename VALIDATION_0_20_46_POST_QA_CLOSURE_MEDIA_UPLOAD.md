# Validação 0.20.46 — Post-QA Closure + Media Upload

## Resultado

**PASS**

## TypeScript estrutural

- App/Next source: PASS
- Cloudflare Core source com stubs de ambiente: PASS

Comandos:

```text
tsc -p tsconfig.validate.json --pretty false
tsc -p cloudflare/tsconfig.validate.json --pretty false
```

## Behavior gates regressivos

- 0.20.42 Production Slot Rejection: **27/27 PASS**
- 0.20.43 Living Overview + Project Media: **23/23 PASS**
- 0.20.44 Atomic PSLOT Rejection: **21/21 PASS**
- 0.20.45 QA by Rejection: **43/43 PASS**
- Migration 9026: **8/8 PASS**
- SQL finalize QA / rollback: **9/9 PASS**

## Behavior gate 0.20.46

**40/40 PASS**

Cobertura principal:

- versão 0.20.46 coerente no App/Core/MCP;
- schema continua 2.26.0, sem migration 9027;
- source checkpoint continua com Core bundle `UNBUILT` para impedir deploy silencioso de bundle antigo;
- `anexar_thumb_arquivo` existe;
- não usa ticket `PREPARED`;
- aceita base64/resource blob/byte array/File/Blob `arrayBuffer()`/HTTPS reescrito pelo runtime;
- valida magic bytes e MIME;
- limita arquivo e máximo de três thumbs;
- IDs estáveis/idempotência;
- SQL exato da candidata MATERIALIZED executa com **14 placeholders / 14 bindings**;
- `finalizar_qa_projeto` usa o novo orquestrador;
- projeto legado já FROZEN pode fechar sem exigir nova rodada QA;
- PITEMs são reconciliados pelos PSLOTs;
- tags `REVISAR` / `REVISADO_PARA_QA` bloqueiam fechamento;
- fechamento enfileira automaticamente `PROJECT_IMAGES_ZIP`;
- pacote pronto de mesma revisão pode ser reaproveitado;
- validador de ZIP expõe todos os campos do contrato;
- Central Directory/EOCD são inspecionados;
- magic bytes das imagens são inspecionados;
- estrutura flat é exigida;
- manifesto é validado **antes** do UPDATE para `READY_FOR_DOWNLOAD`;
- falha gera `FORMA_ZIP_MANIFEST_INVALID`;
- smoke ZIP válido: PASS;
- smoke ZIP inválido: corretamente rejeitado.

Arquivo do gate:

`BEHAVIOR_GATE_0_20_46_POST_QA_CLOSURE_MEDIA_UPLOAD.json`

## Observação sobre build completo

O checkpoint fonte permanece propositalmente com `lib/generated-core-bundle.ts` em `UNBUILT`. O `prebuild` usa a versão do `package.json` para gerar o bundle Core correspondente durante o deploy após a instalação das dependências. Isso evita empacotar silenciosamente um Worker de versão anterior.
