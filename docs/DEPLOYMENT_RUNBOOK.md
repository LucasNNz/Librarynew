# Runbook — Corvo Library V2 0.12

## Para o usuário final

A implantação da infraestrutura operacional não exige CLI local. Depois que o frontend estiver publicado, abra **Configurações** e execute o assistente autossuficiente com um Cloudflare API Token. D1, R2, Queue, DLQ, Worker, restore e manifesto são tratados pelo próprio app.

O frontend não depende de `CORVO_CORE_URL` ou chaves configuradas manualmente na hospedagem.

## Para desenvolvimento/CI

Antes de publicar uma nova versão do código, mantenha os gates de engenharia:

```bash
python scripts/validate-checkpoint.py /caminho/CORVO_LIBRARY_V2_D1_CLEAN_BASELINE.sql
npm ci
npm run build
```

O `prebuild` gera um bundle autocontido do Corvo Core dentro do artefato do frontend. Esse bundle é usado tanto na primeira configuração quanto nas atualizações do Core.

## Primeira instalação pelo app

O endpoint same-origin de setup usa o token fornecido temporariamente pelo usuário para chamar a API oficial da Cloudflare e:

1. localizar/criar D1;
2. verificar `corvoquiz-prod`;
3. localizar/criar Queue + DLQ;
4. publicar Worker com bindings `DB`, `MEDIA`, `MATERIALIZE_QUEUE`;
5. guardar chaves e token como Worker secrets;
6. importar o bootstrap D1 se necessário;
7. habilitar o domínio `workers.dev` do Core;
8. salvar a conexão no navegador e o manifesto não secreto no D1.

## Atualização do Core

A partir da primeira configuração o token de controle já vive no Worker. Uma nova versão do frontend pode solicitar `/control/update-core`; o Worker busca o bundle somente da origem do app gravada em `CORVO_APP_ORIGIN` e reaplica o próprio script preservando os mesmos D1/R2/Queue e secrets.

Se o token Cloudflare for revogado, o Core continua operando normalmente para catálogo/R2/Queue; apenas operações administrativas de reconfiguração/auto-update exigirão informar um token novo.

## Corte de produção

Antes de substituir a Library antiga valide:

- `/health`: D1, R2, schema, appAuth, signing e control;
- `/data-health`: zero órfãos V2;
- catálogo real e imagens;
- FAST PUSH → Queue → R2 → Inbox;
- aprovação e download;
- pacote final/ZIP;
- redeploy do frontend sem reconfiguração;
- atualização do Core sem reset de D1/R2/Queue.

## 0.20.36 — binding técnico de conversão para o Forma

O Core 0.20.36 usa o binding Cloudflare Images `IMAGES` **somente** quando o formato real dos bytes do asset não coincide com a extensão pedida pelo `target_file` final (`.jpg`, `.png` ou `.webp`). O self-update do Core e `cloudflare/wrangler.jsonc.example` já incluem esse binding.

Se todos os assets já estiverem no formato físico correto, o exportador não chama `IMAGES`. Se houver mismatch e o binding não estiver provisionado, o artefato falha explicitamente com `IMAGES_BINDING_REQUIRED`; o sistema nunca resolve o caso apenas trocando a extensão do arquivo.
