# 0.20.24 — MCP Inline Script Upload

## Objetivo
Eliminar a dependência de `ticket -> uploadUrl -> PUT externo -> confirmar` para o arquivo textual `SCRIPT` produzido por agentes GPT/MCP. Esse salto externo podia falhar por DNS/rede antes de chegar ao R2, deixando projetos em `WAITING_FILES` mesmo quando o MCP estava saudável.

## Novo caminho MCP

### `anexar_script_projeto`
Entrada:
- `projeto_id`
- `conteudo`
- `nome_arquivo` opcional (padrão `SCRIPT.txt`)

Fluxo:
`MCP -> bytes UTF-8 -> R2 -> automatic_project_files -> evento D1 -> resposta final`

Não há `uploadUrl`, PUT externo ou confirmação separada.

## Idempotência
- SHA-256 do conteúdo.
- `projectFileId` determinístico por projeto + role SCRIPT + hash.
- Reenvio do mesmo roteiro retorna o arquivo já existente com `idempotent: true`.
- R2 recebe `Uint8Array` de tamanho conhecido.

## Proteção do caminho antigo
`anexar_arquivo_projeto` continua disponível para binários/anexos, porém `role=SCRIPT` retorna `SCRIPT_USE_INLINE_MCP` e aponta para `anexar_script_projeto`.

## Compatibilidade
- Nenhuma migration nova.
- Schema continua 2.18.0.
- Queue/coletor 0.20.22 preservados.
- Rotação de chave 0.20.23 preservada.
- MCP público do ChatGPT continua sem autenticação.

## Gates
- Frontend structural TypeScript: PASS
- Worker structural TypeScript: PASS
- Embedded Worker `node --check`: PASS
- Validator completo: PASS / 0 erros
- SQL de versionamento/idempotência: PASS
