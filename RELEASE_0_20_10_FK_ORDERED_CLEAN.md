# Corvo Library V2 0.20.10 — FK-Ordered Clean

## Erro corrigido

O Cloudflare D1 rejeita `PRAGMA foreign_keys = OFF` no contexto transacional da
execução remota. A versão 0.20.9 falhava antes de apagar qualquer registro.

## Implementação

- consulta `PRAGMA foreign_key_list` para cada tabela operacional existente;
- monta o grafo real de dependências;
- apaga tabelas filhas antes de suas tabelas pai;
- ignora autorreferências, pois um `DELETE` integral é validado ao final da
  própria instrução;
- executa cada tabela separadamente;
- em caso de falha, retorna `OPERATIONAL_CLEAN_TABLE_FAILED:<tabela>:<detalhe>`;
- preserva infraestrutura, migration registry, conexão do navegador e secrets.

O marcador one-shot agora é `operational_clean_release_0_20_10`.
