# RELEASE 0.20.33 — Inline References No-Ticket

## Objetivo

Eliminar definitivamente a dependência de ticket/PUT externo para o TXT do slot **Referências do Coletor**.

## Contrato MCP

### `anexar_referencias_projeto`

Entrada:

- `projeto_id`
- `conteudo`
- `nome_arquivo` opcional
- `agente` opcional

Comportamento:

1. valida o projeto;
2. calcula hash idempotente do conteúdo;
3. grava o TXT diretamente no R2;
4. cria/versiona `automatic_project_files` no D1 com role `REFERENCES`;
5. registra evento `REFERENCES_ATTACHED_INLINE`;
6. abre explicitamente `v2_project_slot_access.reference` para MCP;
7. incrementa `state_version`;
8. marca o slot como semanticamente pronto por existência do arquivo;
9. devolve conteúdo copiável, preview e download.

Resposta inclui:

- `transport: MCP_INLINE`
- `external_put_required: false`
- `slot_key: reference`
- `slot_state: READY`
- `state_version`
- `content` / `copyable_content`
- `preview_url`
- `download_url`

A chamada é idempotente pelo conteúdo. Se o índice D1 existir mas o objeto R2 tiver desaparecido, a própria chamada restaura o arquivo e registra `REFERENCES_REPAIRED_INLINE`.

### `obter_referencias_projeto`

Retorna o TXT mais recente (ou versão solicitada), conteúdo inline e links temporários de preview/download.

## Hard gate contra ticket externo

`anexar_arquivo_projeto` agora bloqueia roles textuais especiais:

- `SCRIPT` -> `SCRIPT_USE_INLINE_MCP` / `anexar_script_projeto`
- `REFERENCES`
- `REFERENCIAS`
- `REFERENCE`
- `REFERENCE_BRIEF`
- `IMAGENS_NECESSARIAS`
- `IMAGENS NECESSARIAS`

Para Referências retorna `REFERENCES_USE_INLINE_MCP` e `required_tool: anexar_referencias_projeto`.

Portanto o MCP não deve mais produzir `uploadUrl`, ticket ou exigir PUT externo para o TXT do Coletor.

## HTTP equivalente

`POST /projects/:projectId/references/inline`

Usa exatamente a mesma função de persistência do MCP, evitando divergência entre UI/API e Supervisor.

## Compatibilidade

Mantém todas as funções do 0.20.32, schema D1 2.21.0 e o pipeline de produção já implementado.
