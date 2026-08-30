# Corvo Library V2 0.20.27 — Project Slot Customization

Atualização sobre 0.20.26 para tornar os projetos editáveis manualmente e por agentes MCP, mantendo lifecycle lock e rastreabilidade.

## Projetos
- checkboxes sempre visíveis na lista;
- `Selecionar visíveis` e contador permanente;
- ações em massa: Concluir, Rejeitar e Excluir permanentemente;
- exclusão permanente também disponível no projeto selecionado;
- confirmação explícita antes de exclusão irreversível.

## Slots customizáveis
Cada projeto expõe os slots `script`, `thumbs`, `titles`, `reference`, `candidates`, `approved` e `zip`.

A interface oferece:
- **Adicionar manualmente**;
- **Abrir para MCP/IA**;
- instrução opcional persistida por slot.

## MCP
Novas ferramentas:
- `configurar_slot_projeto`;
- `obter_slots_abertos_projeto`;
- `preencher_slot_imagem_projeto`;
- `preencher_slot_texto_projeto`;
- `vincular_asset_slot_projeto`.

O preenchimento por MCP exige slot explicitamente aberto. Projetos `COMPLETED` ou `REJECTED` continuam bloqueados até reabertura explícita.

## Persistência
Migration `9020_v2_project_slot_customization.sql` cria `v2_project_slot_access` e avança o contrato para schema **2.20.0**.

## Compatibilidade
- App/Core: **0.20.27**;
- schema: **2.20.0**;
- Queue/D1/R2 preservados;
- nenhuma limpeza destrutiva.
