# Corvo Library V2 0.20.8 — Clean Once

## Origem dos dados que reapareciam

Assets e projetos são indexados no D1. Esvaziar o bucket R2 não remove esses
registros, portanto a interface continuava exibindo os metadados históricos.
Não havia seed ou mock no frontend.

## Limpeza única

A migration `9015_v2_operational_clean_once.sql`:

- limpa catálogo, projetos, solicitações, lotes, imports, operações, filas,
  auditorias e demais dados operacionais;
- preserva `v2_infrastructure_profiles` e
  `v2_infrastructure_config_events`;
- preserva `v2_migrations_applied`, garantindo execução única;
- não acessa nem altera Worker secrets;
- não altera a conexão/chave salva no `localStorage` do navegador.

O boot aplica a migration e somente libera a interface depois de confirmar
zero assets e zero projetos. Nos boots seguintes, a migration não é repetida e
novos dados reais criados pelo usuário são preservados.
