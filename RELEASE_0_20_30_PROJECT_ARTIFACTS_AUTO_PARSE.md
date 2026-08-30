# Corvo Library V2 0.20.30 — Project Artifacts + SCRIPT Auto Parse

## 1. Arquivos anexados imediatamente visíveis ao MCP

A persistência do projeto passa a tratar `state_version` como sinal de mudança também para artefatos.

- `PROJECT_FILE` confirmado incrementa `state_version` no mesmo fluxo de persistência D1;
- SCRIPT inline incrementa `state_version` e dispara interpretação;
- upload direto de imagem ligado a projeto incrementa `state_version`;
- imagem do Coletor ao chegar em `MATERIALIZED` incrementa `state_version`;
- aprovação/rejeição de candidata ligada ao projeto incrementa `state_version`;
- thumbs/mídias e ZIP final já atualizam o projeto e permanecem cobertos pelo inventário.

O snapshot operacional expõe um resumo compacto de anexos e o MCP recebe duas ferramentas dedicadas:

- `listar_arquivos_projeto`;
- `listar_artefatos_projeto`.

`listar_artefatos_projeto` agrega SCRIPT/REQUIREMENTS/anexos, candidatas materializadas, assets aprovados, mídia do projeto e pacotes ZIP.

## 2. SCRIPT recebido → interpretação → cenas

Ao anexar um SCRIPT textual, o Core tenta materializar as cenas imediatamente e de forma idempotente.

Cabeçalhos reconhecidos incluem:

- `CENA-001`;
- `CENA 001`;
- `[CENA 001]`;
- `SCENE 001`;
- `ID: CENA-001`;
- `[01]`.

Quando há cenas:

- cria/atualiza `automatic_project_items` por `item_key` estável;
- preserva universo, sujeito, conceito/referência e trecho do roteiro;
- atualiza `total_items`;
- coloca o projeto em `ACTIVE / PROCESSANDO / DISPATCH`;
- executa reconciliação para criar `worker_work_items` faltantes.

Quando não há cabeçalhos reconhecíveis, o projeto não finge conclusão: registra `SCRIPT_PARSE_NO_SCENES` e fica em `INTERPRETANDO_ROTEIRO / PARSE_SCRIPT`.

## 3. Self-healing para projetos antigos

`reconcileAutomaticProject` detecta projeto com SCRIPT persistido e `0` itens. Antes de calcular `WAITING_FILES`, lê o último SCRIPT textual no R2 e tenta materializar as cenas.

`obter_slot_projeto` também aciona esse caminho quando encontra o estado legado `WAITING_FILES / AGUARDANDO + SCRIPT + total_items=0`.

## 4. Visualização e download individual

A tela de Projetos ganha `Arquivos e artefatos`.

Cada linha informa nome, origem/etapa, status e tamanho. Quando aplicável:

- `Ver` abre preview inline de texto, imagem, vídeo, áudio, JSON/XML ou PDF;
- `Baixar` entrega o objeto com comportamento de attachment;
- ZIPs permanecem download-only.

Os links são assinados e temporários; não há exposição pública permanente do R2.

## Compatibilidade

- App/Core/MCP: **0.20.30**;
- schema D1: **2.20.0**;
- sem migration destrutiva nova;
- FAST READ 0.20.28 preservado;
- Collector Refinements 0.20.29 preservado;
- Project Slot Customization preservado.
