# Release 0.20.39 — PROJECT_IMAGES_ZIP Stream + Final Failure State + FAST READ SQL

## Escopo
Correção cirúrgica sobre 0.20.38. Não altera parser, production scenes, production slots, pools, QA, coleta ou contrato dos 3 artefatos finais.

## 1. PROJECT_IMAGES_ZIP — causa raiz do pipeTo
O `FixedLengthStream` estava correto. A regressão estava no ramo de hash SHA-256 adicionado depois do exportador 0.20.35.

Antes:
```ts
const digestStream = new DigestStream("SHA-256");
hashBranch.pipeTo(digestStream.writable); // destino inválido no runtime Cloudflare
```

Agora:
```ts
const digestStream = new DigestStream("SHA-256");
r2Branch.pipeTo(fixed.writable);
hashBranch.pipeTo(digestStream);
```

No runtime Cloudflare, `DigestStream` é o próprio `WritableStream`; não se usa `.writable`.

O upload para R2 continua recebendo `fixed.readable`, com comprimento conhecido.

## 2. FINAL_ARTIFACT_FAILED permanece FAILED
O catch já persistia `v2_download_packages.status='FAILED'`, porém relançava a exceção. O consumer da Queue então executava retry e `processPackageJob` voltava a marcar o mesmo pacote como `PROCESSING`.

Agora, para os 3 artefatos finais independentes, após persistir FAILED o job retorna normalmente e a Queue dá ACK. Uma nova tentativa só acontece por nova solicitação explícita.

Também incrementa `state_version` na falha para o MCP perceber a mudança imediatamente.

## 3. FAST READ — palavra reservada REFERENCES
Removido alias SQL:
```sql
AS references
```

Substituído por:
```sql
AS reference_files
```

O contrato externo continua expondo `attachments.references`.

## Não regredir
- 72 questions
- 72 production scenes
- production slots preservados
- 3 artefatos independentes
- `PROJECT_SCRIPT_TXT` independente de `PROJECT_IMAGES_ZIP`
- `FixedLengthStream`/body com tamanho conhecido para ZIP

## Schema
Sem migration nova. Schema permanece 2.23.0.
