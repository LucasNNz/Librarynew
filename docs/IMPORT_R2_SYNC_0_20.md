# Importação e reconciliação R2 — 0.20.0

## Objetivo

A Corvo Library 0.20 transforma o R2 em armazenamento físico durável e o D1 em catálogo pesquisável, mantendo evidência suficiente no próprio objeto R2 para reconstruir referências do catálogo quando necessário.

## Fluxo de importação

1. **Assets → Importar & R2** aceita múltiplos ZIPs.
2. Cada lote recebe um ticket temporário e é enviado **direto do navegador para o Worker/R2**; o binário não passa pelo servidor Next.
3. O Worker lê `IMPORTACAO.txt`, calcula SHA-256 do conteúdo real e deriva um ID estável `AST-*` do hash.
4. O objeto final é gravado em `assets/{assetId}/{arquivo}` com metadata de recuperação (`assetId`, nome, universo, tipo, sujeito, QA, classificação, confiança, SHA-256 e importId).
5. O D1 é catalogado/atualizado. Reimportar o mesmo SHA-256 reutiliza o asset em vez de criar duplicata.
6. O ZIP de transporte é removido do R2 ao final; apenas os assets materializados permanecem.
7. A interface atualiza métricas e executa a reconciliação R2 × D1.

## Política de classificação do pacote inicial

- `CONFIRMADO` → **Catálogo / Aprovado**
- `GENERICO` → **Catálogo / Aprovado**
- `CONFIRMADO_MEDIO` → **Pendentes / Ressalva**
- `REVISAR_UNIVERSO` → **Pendentes / Ressalva**
- `QUARENTENA` → **fora da carga principal**

A classificação explícita do manifesto prevalece sobre o `STATUS_QA: NAO_AVALIADO` legado do pacote. Divergência entre o SHA-256 declarado e o conteúdo real força o item para Pendentes e gera aviso.

## Reconciliação R2 × D1

`POST /storage/sync-r2` percorre `assets/` com paginação e cruza as chaves físicas com o D1.

- **R2 sem D1:** com `repair=true`, reconstrói o registro usando custom metadata; quando metadata completa não existir, só usa fallback pelo `AST-*` presente no caminho e mantém o item pendente.
- **D1 sem R2:** sinaliza como `missingInR2`; não inventa, não substitui e não exclui automaticamente.
- **Varredura truncada:** nunca declara o estado como saudável.
- **Recovery sidecars:** `v2_recovery_events.r2_key` entra no inventário de referências sem contar múltiplos eventos do mesmo sidecar como objetos compartilhados.

## Limites seguros

O endpoint de upload ZIP aceita **até 48 MiB** por lote. O pacote preparado para esta versão usa margem adicional: cada lote fica em aproximadamente **20 MiB ou menos**, com no máximo 40 assets.

Esse limite evita carregar o ZIP original de ~364 MB inteiro na memória do Worker e reduz o risco de uma importação longa bloquear toda a carga.

## Resultado esperado no baseline limpo

Com `CORVO_LIBRARY_IMPORT_R2_READY_V2_20` completo:

- 792 assets importáveis;
- 672 aprovados;
- 120 pendentes;
- 0 rejeitados;
- 81 universos com pelo menos um asset aprovado, sem contar `Sem universo`;
- 9 itens permanecem em quarentena fora da carga principal.
