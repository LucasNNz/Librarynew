# Corvo Library V2 0.20.46 — Post-QA Closure + Media Upload

## Objetivo

Fechar as lacunas operacionais que permaneciam após o QA por rejeição da 0.20.45:

1. permitir que um agente MCP anexe uma thumb local sem depender de ticket `PREPARED` + PUT externo;
2. transformar `finalizar_qa_projeto` no fechamento operacional completo do pós-QA;
3. reconciliar os PITEMs legados pela verdade dos `PRODUCTION_SLOTs`;
4. validar o conteúdo interno de `imagens.zip` antes de expor `READY_FOR_DOWNLOAD`.

O schema D1 permanece em **2.26.0**. Esta release não adiciona migration.

## 1. `anexar_thumb_arquivo`

Nova rota MCP dedicada a arquivo/anexo local:

`arquivo -> bytes/ref runtime -> R2 -> candidate MATERIALIZED -> v2_project_media THUMB`

Características:

- não devolve ticket `PREPARED`;
- não exige PUT do ChatGPT para Worker/R2;
- não exige URL pública fornecida pelo usuário;
- aceita base64/data URI/resource blob/byte array;
- aceita File/Blob por duck typing de `arrayBuffer()`;
- aceita referência HTTPS quando o runtime reescreve o file object para uma URL temporária;
- valida magic bytes e MIME real de JPEG/PNG/WEBP/GIF;
- limite de 24 MiB por thumb;
- respeita o máximo de 3 thumbs ativas por projeto;
- usa IDs estáveis pelo SHA-256 para retry idempotente;
- se o R2 já recebeu o objeto e a chamada falha depois, o retry reaproveita a mesma key/candidata em vez de duplicar mídia.

`importar_midia_arquivo` continua existindo para catálogo/compatibilidade, mas sua descrição agora orienta o agente a usar `anexar_thumb_arquivo` para thumbs locais de projeto.

## 2. Fechamento real do QA

`finalizar_qa_projeto` agora chama o orquestrador `finalizeQaAndQueueDelivery`.

Fluxo:

1. finaliza os sobreviventes `ASSIGNED_FOR_QA` usando a atomicidade da 0.20.45;
2. se não houver `ASSIGNED_FOR_QA` porque o projeto é legado e já está 100% `FROZEN`, o fechamento continua normalmente;
3. reconcilia PITEMs antigos pela verdade dos PSLOTs;
4. verifica zero `PENDING`, `ASSIGNED_FOR_QA` e `RELINK_REQUIRED`;
5. verifica ausência das tags bloqueadoras `REVISAR` e `REVISADO_PARA_QA`;
6. grava `pipeline_status=QA_CONCLUIDO`;
7. ativa a workflow tag persistente `QA_CONCLUIDO`;
8. enfileira automaticamente `PROJECT_IMAGES_ZIP`;
9. se uma revisão idêntica do ZIP já estiver pronta, reutiliza o pacote em vez de gerar outra cópia;
10. valida o pacote pronto antes de apontar o próximo passo para download.

Se ainda existir qualquer gap, o fechamento não força a entrega. Ele devolve os bloqueadores e mantém o próximo passo em relink/QA/atribuição.

## 3. PRODUCTION_SLOT como fonte de verdade

Nova reconciliação `reconcileLegacyProjectItemsFromProduction`.

Ela sincroniza os PITEMs históricos para:

- todos os PSLOTs da cena FROZEN -> PITEM `FROZEN / DONE / QA_COMPLETE`;
- algum PSLOT `RELINK_REQUIRED` -> PITEM `RELINK_REQUIRED`;
- algum PSLOT `ASSIGNED_FOR_QA` -> PITEM `ASSIGNED_FOR_QA / QA_PENDING`;
- demais casos -> `COLLECTING`.

Também cancela `worker_work_items READY/LEASED` de itens que já foram resolvidos pela produção, evitando que o dispatcher ressuscite trabalho antigo.

`reconcileAutomaticProject` executa essa sincronização antes de derivar seus contadores. Portanto, um projeto `102/102 FROZEN` não deve mais aparecer como `70 COLLECTING + 2 RELINK_REQUIRED` por causa da camada legada.

## 4. Gate interno de `imagens.zip`

Nova rota MCP:

`validar_imagens_zip_projeto`

Contrato de saída principal:

```text
expected
found
missing
unexpected
duplicates
invalid
flat
ok
```

A validação:

- lê o EOCD e o Central Directory do ZIP diretamente no R2;
- compara os nomes esperados com os `target_file` do roteiro ativo;
- detecta arquivos ausentes;
- detecta arquivos inesperados;
- detecta nomes duplicados;
- exige estrutura flat;
- lê o local header e os primeiros bytes do payload de cada entrada;
- confirma JPEG/PNG/WEBP pelo conteúdo real, e não somente pela extensão.

O gerador de `PROJECT_IMAGES_ZIP` usa **o mesmo gate** antes de atualizar o pacote para `READY_FOR_DOWNLOAD`.

Falha de manifesto gera `FORMA_ZIP_MANIFEST_INVALID` e o pacote fica `FAILED`, nunca `READY_FOR_DOWNLOAD`.

## 5. Estado final

Depois de QA fechado + ZIP validado:

```text
project.status          = ACTIVE
project.pipeline_status = READY_FOR_DOWNLOAD
project.next_action     = DOWNLOAD_IMAGES_ZIP
workflow tag            = QA_CONCLUIDO
images.zip              = READY_FOR_DOWNLOAD
```

O projeto não é marcado `COMPLETED` automaticamente. `COMPLETED` continua sendo um lifecycle lock explícito do usuário.

## Compatibilidade preservada

- rejeição individual de PSLOT 0.20.42;
- Living Overview / mídias de projeto 0.20.43;
- rejeição atômica 0.20.44;
- `ASSIGNED_FOR_QA` + QA por rejeição 0.20.45;
- schema/migration 9026 preservados;
- `FROZEN` continua imutável para Coletor;
- promotion de externa continua ocorrendo somente após QA.
