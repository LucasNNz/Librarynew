# Corvo Library V2 0.20.43 — Living Overview + Project Profile Media

## Objetivo
Refinar a tela inicial para ficar mais viva, fiel ao estado real de cada projeto e permitir imagem de perfil persistente por projeto, controlável manualmente ou via MCP.

## Interface
- Percentuais de conclusão ligeiramente maiores com brilho suave.
- KPI de taxa de sucesso com ênfase luminosa sem aumentar ruído visual.
- Correntes dos agentes com animação contínua em loop (`stroke-dashoffset`) e sweep ambiente suave.
- Estados por agente/projeto agora são calculados individualmente: `waiting`, `working` ou `done` conforme tags reais do projeto. Um projeto iniciado não acende artificialmente todas as linhas.
- Cards de projetos com slot visual de foto, hover suave, zoom mínimo e controles discretos.
- Foto pode ser trocada por arquivo local, AST aprovado da Biblioteca ou URL externa.
- Origem da foto fica indicada no card.

## Foto de perfil do projeto
Sem migration nova: reutiliza `v2_project_media` com `kind=PROJECT_PROFILE`.

A troca preserva mídia anterior e histórico:
- foto atual: `PROFILE_ACTIVE`, `selected=1`;
- foto substituída: `PROFILE_REPLACED`, `selected=0`;
- nenhum AST é alterado ou apagado;
- nenhum objeto R2 é apagado;
- AST da Biblioteca é reutilizado por referência, sem copiar bytes.

### Fontes aceitas
- AST aprovado (`assetId` / `asset_id`);
- candidata `MATERIALIZED`/`APPROVED`;
- URL externa, materializada pelo FAST PUSH;
- arquivo local pela UI, usando Direct Upload → R2 → candidate → PROJECT_PROFILE.

## API Core
- `GET /projects/:id/profile-image`
- `POST /projects/:id/profile-image`
  - `assetId`
  - `candidateId`
  - `url`
- `DELETE /projects/:id/profile-image`

## MCP
Novas ferramentas:
- `definir_foto_perfil_projeto`
- `obter_foto_perfil_projeto`
- `remover_foto_perfil_projeto`
- `anexar_thumb_projeto`

`anexar_thumb_projeto` é o caminho direto para o agente enviar thumb sem precisar abrir previamente o slot de customização.

## Correção importante de thumbs
O fluxo de arquivo local já criava uma candidata `MATERIALIZED`, mas o `confirmDirectUpload` não promovia automaticamente uma candidata marcada com `thumb` para `v2_project_media/THUMB`.

A 0.20.43 corrige isso:
- `directTags.includes("thumb")` → cria THUMB automaticamente;
- `directTags.includes("project-profile")` → define PROJECT_PROFILE automaticamente;
- FAST PUSH externo mantém o mesmo comportamento após a materialização na Queue.

## Compatibilidade D1
Schema continua em **2.25.0**. Nenhuma coluna/tabela nova foi adicionada, evitando uma migration desnecessária logo após o hotfix de `previous_asset_id`.

## Bundle
`scripts/build-core-bundle.mjs` agora usa a versão do `package.json` automaticamente para `CORE_WORKER_BUNDLE_VERSION`, eliminando divergência manual entre app e Worker em releases futuras.
