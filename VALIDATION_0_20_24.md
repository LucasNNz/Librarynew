# Validation 0.20.24

**Resultado: PASS — 0 erros**

- Checkpoint: 0.20.24
- Schema: 2.18.0 (sem migration nova)
- `anexar_script_projeto`: registrado no MCP
- `anexar_arquivo_projeto(role=SCRIPT)`: bloqueia ticket externo e direciona ao inline MCP
- SCRIPT: bytes UTF-8 de tamanho conhecido -> R2 -> D1 em uma chamada
- Idempotência: projeto + SCRIPT + SHA-256
- Frontend TypeScript: PASS
- Worker TypeScript: PASS
- Embedded bundle: `node --check` PASS
- Validator completo: PASS / 0 erros
