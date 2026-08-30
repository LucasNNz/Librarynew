# Release 0.20.38 — Tags Visuais Persistentes por Slot

## Objetivo
Adicionar uma camada simples de contexto persistente por slot: o app **armazena + mostra + expõe**, sem codificar workflow ou prioridade.

## D1
Nova migration `9023_v2_persistent_slot_visual_tags.sql` / schema `2.23.0`.

Tabela `v2_slot_tags`:
- `id`
- `project_id`
- `slot_id`
- `tag_key`
- `emoji`
- `label`
- `note`
- `created_by`
- `created_at`
- `updated_at`
- `active`
- `removed_at`

Unicidade: `(project_id, slot_id, tag_key)`.

## MCP
Novas ferramentas:
- `criar_tag_slot`
- `remover_tag_slot`
- `listar_tags_slot`
- `buscar_slots_por_tag`
- `listar_tags_projeto`

A leitura é passiva: tags também aparecem em `obter_slot_projeto`, `obter_slots_abertos_projeto` e nos `production_slots` de `obter_modelo_producao`.

## UI
- emoji flutuante no canto superior do slot;
- brilho/borda sutil quando existe tag ativa;
- 1–2 emojis visíveis e `+N` para excesso;
- tooltip nativo com emoji, label, nota e criador;
- cor do brilho derivada deterministicamente da `tag_key`, portanto novas tags não exigem deploy visual.

## Regras
- múltiplas tags simultâneas;
- criação idempotente;
- remoção idempotente;
- nenhuma limpeza automática por troca de agente;
- significado da tag continua fora do app;
- `state_version` é incrementado quando uma tag é criada/reativada/removida.
