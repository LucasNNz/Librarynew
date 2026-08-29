# Bootstrap do D1 — sem conversão

A Corvo Library V2 NÃO converte o banco histórico para outro modelo.

Ordem segura:

1. Criar um novo D1 `corvo-library-v2`.
2. Restaurar o dump histórico D1/SQLite preservando tabelas, IDs e `r2_key`.
3. Remover/ignorar os três settings históricos redigidos de segredo; a V2 não os usa.
4. Aplicar `migrations/9000_v2_core.sql` para criar somente tabelas `v2_*`.
5. Vincular `MEDIA` diretamente ao bucket existente `corvoquiz-prod`.
6. Vincular `MATERIALIZE_QUEUE` à queue V2.
7. Salvar `CORVO_INTERNAL_KEY` como secret do Worker, nunca no D1.

O Worker lê diretamente a tabela histórica `assets`. Não existe etapa Turso, libSQL, seed de produção ou tradução permanente de schema.
