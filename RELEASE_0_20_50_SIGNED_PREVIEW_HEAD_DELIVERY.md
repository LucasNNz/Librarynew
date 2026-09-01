# Corvo Library V2 0.20.50 — Signed Preview HEAD Delivery

## Problema corrigido

Os links assinados de preview (`/candidate-files/:id`, `/thumbs/:id` e rotas equivalentes) eram publicados somente para `GET`.
O próprio `testar_url` e diversos scanners/visualizadores fazem `HEAD` antes de abrir o corpo. O `HEAD` caía no fallback do Worker e retornava `404 Not Found`, fazendo o cliente considerar o preview quebrado antes do GET.

O D1, o objeto R2 e a assinatura estavam corretos; a lacuna estava na superfície HTTP pública do Worker.

## Correção

- rotas assinadas de mídia agora aceitam `GET` e `HEAD`;
- `HEAD` valida a mesma assinatura e o mesmo registro D1;
- candidatas/assets usam `R2.head()` no HEAD, sem transportar pixels;
- `/thumbs/:assetId` checa primeiro thumbnail cacheada e depois o objeto original, sem disparar transformação remota durante HEAD;
- GET continua servindo o corpo normalmente;
- respostas incluem `x-corvo-public-media-route` e `x-corvo-core-version` para diagnóstico;
- `testar_url` continua preferindo HEAD, mas faz fallback para GET com `Range: bytes=0-0` quando um host válido não implementa HEAD.

## Rotas cobertas

- `/files/:assetId`
- `/thumbs/:assetId`
- `/candidate-files/:candidateId`
- `/supervisor-candidate-files/:candidateId`
- `/package-files/:packageId`
- `/project-media/:mediaId`
- `/project-files/:fileId`

`asset-exports` permanece GET-only porque a leitura possui semântica de download/contagem e não faz parte do preview visual.

## Compatibilidade

- schema D1 permanece `2.26.0`;
- nenhuma migration nova;
- QA por rejeição preservado;
- upload direto de thumb preservado;
- hotfix 16/16 de THUMB preservado;
- thumb/título continuam opcionais para conclusão;
- UX 0.20.49 preservada.
