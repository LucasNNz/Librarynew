# Validação 0.20.45 — Coletor Provisório + QA por Rejeição

## Resultado

Os gates disponíveis no checkpoint passaram.

### Regressão preservada

- `behavior-gate-0-20-42-production-slot-rejection.py`: **27/27 PASS**
- `behavior-gate-0-20-43-living-overview.py`: **23/23 PASS**
- `behavior-gate-0-20-44-atomic-pslot-rejection.py`: **21/21 PASS**

Isso preserva rejeição individual, interface 0.20.43 e atomicidade/idempotência da 0.20.44.

### Novo comportamento 0.20.45

- `behavior-gate-0-20-45-qa-by-rejection.py`: **43/43 PASS**

Entre os checks:

- AST da Biblioteca entra no PSLOT como `ASSIGNED_FOR_QA`;
- candidata externa entra por `candidate_id` e permanece `MATERIALIZED` antes do QA;
- candidata externa não é promovida antecipadamente;
- `FROZEN` não pode ser sobrescrito pelo Coletor;
- `ASSIGNED_FOR_QA` ativo não é silenciosamente trocado por outra candidata;
- `COLLECTOR_FINISHED` espera todos os gaps/pending serem abastecidos;
- `ready_for_qa` exige zero `PENDING` e zero `RELINK_REQUIRED`;
- rejeição preserva proveniência de candidata;
- rejeição continua atômica;
- rota `atribuir_candidatas_aos_slots_para_qa` existe;
- rota `obter_production_slots_para_qa` existe;
- leitura do QA gera preview assinado para Biblioteca e candidata externa;
- leitura do QA é explicitamente reject-only;
- rota `finalizar_qa_projeto` existe;
- finalização lê apenas sobreviventes `ASSIGNED_FOR_QA`;
- sobrevivente externo é promovido somente depois do QA;
- sobrevivente vira `FROZEN`;
- uso é registrado no fechamento;
- finalização é idempotente por commit marker;
- finalização usa `D1.batch()` atômico;
- guard concorrente participa da transação;
- rollback possui limpeza best-effort do R2 preparado;
- `RELINK_REQUIRED` é ignorado pela promoção;
- export final não aceita `ASSIGNED_FOR_QA` como estado final;
- novas contagens estão expostas;
- workflow recebe o estado de QA;
- estimativa para 500 slots fica em aproximadamente **366 statements**, abaixo do teto operacional adotado pelo projeto.

### Migration/schema

- `migration-gate-0-20-45.py`: **8/8 PASS**

Valida:

- migration 9026 sobre shape 2.25;
- colunas provisórias do PSLOT;
- proveniência de candidata no histórico;
- normalização dos estados finais legados para FROZEN;
- schema `2.26.0`;
- proteção de replay no boot;
- proteção de replay no restore;
- contrato crítico sincronizado.

### SQL real da finalização

- `sql-gate-0-20-45-qa-finalize.py`: **9/9 PASS**

Valida em SQLite transacional:

- PSLOT promovido e congelado;
- candidata promovida;
- `asset_usage` exatamente uma vez;
- projeto avança após FROZEN;
- proveniência `candidate_id` preservada;
- falha forçada no guard;
- rollback restaura PSLOT;
- rollback remove commit marker;
- rollback remove artefato do guard.

### TypeScript estrutural

`npm run validate:structural`: **PASS**

O gate executa os dois projetos TypeScript estruturais incluídos no checkpoint:

- app;
- Core/Cloudflare.

## Limitação desta máquina de empacotamento

O checkpoint não contém `node_modules` por design. Nesta sessão, a instalação completa de dependências não ficou disponível, portanto o `next build` de produção não foi contabilizado como PASS local.

Para evitar um Worker embutido antigo, `lib/generated-core-bundle.ts` é distribuído propositalmente como `UNBUILT`. O `prebuild` do projeto executa `scripts/build-core-bundle.mjs` depois que as dependências forem instaladas no ambiente de deploy e gera o Core correspondente exatamente à versão `0.20.45`.

Isso é uma limitação de validação do ambiente desta sessão, não um PASS artificial de build.
