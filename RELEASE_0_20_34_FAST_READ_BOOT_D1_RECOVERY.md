# RELEASE 0.20.34 — FAST READ BOOT / D1 RECOVERY

## Sintoma corrigido

A UI podia mostrar:

```text
D1 REAL
Não foi possível ler o D1
FAST_READ_BOOT_FAILED:{"httpStatus":200,"coreVersion":"0.20.31","d1":null,"schema":null,...}
```

mesmo durante uma atualização válida do Core.

## Causa

`/ui/boot` usa a Cache API do Cloudflare. Entradas em `caches.default` podem sobreviver ao deploy do Worker por alguns segundos. Assim, após `/health` já enxergar o Worker novo, uma leitura imediata de `/ui/boot` podia receber o snapshot compacto produzido pela release anterior.

O diagnóstico final também inspecionava o envelope de boot em vez de `health.core`, por isso `d1/schema` apareciam como `null` e mascaravam a causa real.

## Correções

1. Cache FAST READ versionado por release com `__corvo_release=0.20.34`.
2. Boot pós-update/pós-migration usa query `fresh=<release>-<timestamp>`.
3. Diagnóstico lê `value.health`/`health.core` e reporta `bootVersion` + `coreVersion`.
4. Falhas HTTP do self-update são propagadas imediatamente.
5. Worker autoatualizável embutido contém a mesma política de namespace.

## Segurança do D1

Nenhum dado é zerado e nenhuma migration nova é necessária. O schema continua em `2.21.0`. A mudança atua somente no caminho de leitura/validação do boot.
