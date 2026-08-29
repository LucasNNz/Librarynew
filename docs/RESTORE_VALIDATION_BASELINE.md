# Baseline validado — restauração D1 V2

Teste local realizado sobre o dump histórico sanitizado + `9000_v2_core.sql`.

| Verificação | Resultado |
|---|---:|
| Tabelas históricas | 47 |
| Tabelas `v2_*` adicionadas | 3 |
| Tabelas totais | 50 |
| Assets | 929 |
| Aprovados | 849 |
| Pendentes | 77 |
| Rejeitados | 3 |
| Universos aprovados | 174 |
| Universos totais | 175 |
| Usos históricos | 1.176 |
| Settings preservados | 39 |
| Settings secretos históricos importados | 0 |
| Assets sem `r2_key` | 0 |
| `r2_key` únicos | 921 |
| Grupos de `r2_key` compartilhados | 8 |

Os 8 grupos compartilhados já existiam no histórico. A V2 os reporta no gate de consistência em vez de reescrever IDs ou objetos automaticamente.

## Garantia desta etapa

A restauração validada não transforma o schema histórico. As tabelas `v2_*` coexistem com as 47 tabelas originais. Isso permite comparar a V2 com a referência sem introduzir uma camada permanente de conversão.
