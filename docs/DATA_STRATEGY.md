# Estratégia de dados V2

## Regra central

- D1 histórico restaurado = fonte de verdade estrutural.
- R2 `corvoquiz-prod` = fonte de verdade física.
- `assets.r2_key` = ponte entre ambos.
- tabelas `v2_*` = apenas funções novas da V2.

## Não fazer

- Não reescrever IDs `AST-*`.
- Não converter status históricos durante a migração.
- Não reorganizar objetos existentes do R2.
- Não armazenar Account ID / Access Key / Secret Key no D1.
- Não usar token de banco para criptografar configuração do R2.

## API

A API normaliza nomes/status para a UI sem alterar o banco. Exemplo:

`Aprovado` no D1 -> `APPROVED` na resposta da API.

Essa normalização é somente apresentação e nunca é persistida de volta automaticamente.
