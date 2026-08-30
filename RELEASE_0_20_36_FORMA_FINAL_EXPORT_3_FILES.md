# Corvo Library V2 0.20.36 — Forma Final Export: 3 arquivos

## Objetivo

Transformar a saída final do projeto em três artefatos independentes e previsíveis:

1. `imagens.zip`
2. `roteiro.txt`
3. `thumbs_titulos.zip`

O ZIP geral legado continua apenas por compatibilidade; ele não é requisito para o fluxo normal do Forma.

## PROJECT_IMAGES_ZIP

- ZIP flat, sem diretórios administrativos;
- contém somente nomes de imagem extraídos do SCRIPT ativo;
- valida production slots resolvidos e existência física no R2;
- rejeita target names conflitantes;
- reabre o índice central do ZIP após gravar no R2 e compara esperado x real;
- exige `missing=0`, `unexpected=0` e `duplicateNames=0` antes de READY;
- o mesmo AST pode ser materializado em N nomes finais sem duplicar o asset na Library;
- extensão final precisa corresponder ao formato real dos bytes;
- conversão técnica JPG/PNG/WEBP usa o binding Cloudflare Images (`IMAGES`) quando necessária;
- CENTRAL_2 e FOCO_4 exigem PNG no target;
- upload do ZIP ao R2 usa `FixedLengthStream` com tamanho conhecido.

## PROJECT_SCRIPT_TXT

- `roteiro.txt` separado, UTF-8 e sem ZIP;
- utiliza exatamente o SCRIPT ativo;
- gate de até 100 perguntas e até 250 referências de imagem;
- parser reconhece blocos numerados como `[1]`, `[72]`, `PERGUNTA 1`, `CENA-001` etc.;
- antes do READY, exige `questions_script == production_scenes_total`;
- o reconciliador também repara drift estrutural (por exemplo 72 perguntas / 60 production scenes) usando o SCRIPT persistido.

## PROJECT_PUBLICATION_ZIP

- `thumbs_titulos.zip` independente;
- contém apenas `thumbs/thumb-XX.ext` e `titulos.txt`;
- não mistura roteiro, imagens de cenas, assets internos, QA, logs ou manifestos administrativos;
- ausência de thumb/título não bloqueia `imagens.zip` nem `roteiro.txt`.

## Reutilização e revisão

Cada tipo calcula revisão própria:

- roteiro: hash do SCRIPT ativo;
- imagens: SCRIPT + manifesto production slot → asset;
- publicação: revisão de thumbs + títulos.

Se a revisão já possuir artefato não-falho, o exportador reutiliza o pacote. Um ajuste editorial não força regeneração de imagens.

## Projeto concluído

A geração e o download dos artefatos finais são operações de exportação sobre estado persistido. Por isso um projeto `COMPLETED` pode reutilizar/regenerar export sem ser reaberto e sem refazer coleta, QA, relink, rotação ou materialização original. Projetos rejeitados/cancelados continuam bloqueados.

## UI e MCP

A UI ganhou a seção **ARQUIVOS FINAIS**, com três cards e download direto.

Ferramentas MCP novas:

- `gerar_arquivos_finais_projeto`
- `obter_arquivos_finais_projeto`
- `obter_link_imagens_zip`
- `obter_link_roteiro_txt`
- `obter_link_thumbs_titulos_zip`

O MCP devolve estado/metadados/link temporário; não transporta o binário.

## Schema

- schema: `2.22.0`;
- migration: `9022_v2_final_exports_forma.sql`;
- `v2_download_packages.revision_hash`;
- `v2_download_packages.mime_type`;
- índice para reutilização por projeto/tipo/revisão/status.

## Worker autoatualizável

O bundle embutido foi sincronizado com 0.20.36 e contém:

- schema 2.22.0;
- parser/reconciliação 0.20.36;
- três exportadores independentes;
- rotas `/projects/:id/final-exports`;
- cinco ferramentas MCP finais;
- dispatch da Queue para o processador 0.20.36;
- binding `IMAGES` no self-update;
- FAST READ namespace 0.20.36.

## Validação

- D1 integrity: PASS;
- schema 2.22.0: PASS;
- frontend structural TypeScript: PASS;
- Worker structural TypeScript: PASS;
- MCP: 277 registrados / 277 únicos / 0 duplicados;
- behavior gate: 25/25 PASS;
- parser smoke: 72 perguntas → 72 production scenes → 102 slots;
- Worker embutido: `node --check` PASS;
- bundle embutido: byte-identical ao Worker 0.20.36 validado.

Build real Next/Wrangler permanece `EXTERNAL_GATE` neste ambiente por indisponibilidade de dependências/conta Cloudflare. O teste real de conversão Cloudflare Images e upload R2 depende do runtime provisionado.
