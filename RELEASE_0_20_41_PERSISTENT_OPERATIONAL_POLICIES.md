# Corvo Library V2 0.20.41 — Persistent Operational Policies

## Objetivo

Transformar regras operacionais recorrentes em contexto persistente do backend, separado de tags temporárias. Políticas acompanham automaticamente o slot e podem ser herdadas por GLOBAL, PRESET, PROJECT e SLOT.

## Entregas

- Schema D1 2.24.0.
- `v2_project_policy_links` para aplicar políticas reutilizáveis a projetos sem duplicar conteúdo.
- Campo `visual_role` em `v2_production_slots` para resolver requisitos por papel visual (`IMAGEM_A`, `IMAGEM_PRINCIPAL`, `IMAGEM_RESULTADO`, etc.).
- Motor `persistent-policies.ts` com criação, edição versionada, soft-delete, ativação/desativação, listagem, vínculo a projeto e resolução automática.
- Herança efetiva: SLOT > PROJECT > PRESET > GLOBAL; políticas não conflitantes acumulam.
- `asset_requirement` e `asset_requirements` por papel visual.
- Leitura passiva de políticas nos slots integrados, production slots, snapshots, QA/Coletor e Relinker.
- 10 ferramentas MCP novas para CRUD/resolução/vínculo.
- Rotas HTTP `/context-policies` equivalentes para a UI.
- UI de Políticas com criar, editar, ativar/desativar, excluir, aplicar/remover de projeto e filtros por escopo/atividade.
- Cards de slot exibem contagem de políticas e requisito visual resolvido sem poluir o card principal.
- Seed inicial obrigatório com 20 políticas `SYSTEM_SEED`: 16 PRESET + 4 GLOBAL.
- Novas políticas podem ser criadas pela IA/MCP sem deploy.

## Compatibilidade preservada

- Tags persistentes continuam independentes das políticas.
- Pipeline 72/72 cenas e 102/102 slots não foi reaberto.
- Exportação final do Forma permanece independente em 3 artefatos.
- O hot path de `PROJECT_IMAGES_ZIP` continua usando `KNOWN_LENGTH_UINT8ARRAY_NO_PIPETO`; a correção do 0.20.40 não foi regredida.

## Worker autoatualizável

O Worker embutido foi sincronizado com o fonte 0.20.41 e contém:

- engine de políticas persistentes;
- 10 ferramentas MCP novas;
- CRUD HTTP;
- herança passiva;
- contexto de políticas para production slots / QA / Coletor / Relinker;
- schema contract 2.24.0;
- preservação do exportador de imagens sem `pipeTo()` no caminho ativo.

## Segurança operacional

O factory zero continua sem dados operacionais de usuário. A única exceção intencional são as 20 políticas determinísticas `SYSTEM_SEED` exigidas pela especificação.
