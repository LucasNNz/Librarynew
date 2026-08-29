# Baseline validado — restauração D1 V2

Gate local executado sobre o dump histórico sanitizado + migrations `9000`–`9007`.

| Verificação | Resultado |
|---|---:|
| Tabelas históricas | 47 |
| Tabelas `v2_*` adicionadas | 15 |
| Tabelas totais | 62 |
| Schema V2 | 2.7.0 |
| Assets | 929 |
| Aprovados | 849 |
| Pendentes | 77 |
| Rejeitados | 3 |
| Universos aprovados | 174 |
| Universos totais | 175 |
| Usos históricos | 1.176 |
| Settings secretos históricos importados | 0 |
| Assets sem `r2_key` | 0 |
| `r2_key` únicos | 921 |
| Grupos de `r2_key` compartilhados | 8 |
| Órfãos `v2_*` | 0 |

Os 8 grupos de `r2_key` compartilhados já existiam no histórico. A V2 reporta o fato sem reescrever IDs ou objetos automaticamente.

## Dívida histórica

O backup contém 11.505 violações de chaves estrangeiras preexistentes. O conjunto exato está congelado em `HISTORICAL_INTEGRITY_BASELINE.json`. Isso não é tratado como PASS silencioso: o gate exige **correspondência exata com o baseline e zero nova orfandade V2**.

Dispatcher e Supervisor filtram registros históricos órfãos em vez de processá-los ou apagá-los.
