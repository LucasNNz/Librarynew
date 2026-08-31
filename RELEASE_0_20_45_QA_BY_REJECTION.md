# Corvo Library V2 0.20.45 — Coletor Provisório + QA por Rejeição

## Objetivo

A 0.20.45 muda o contrato operacional de imagens de produção para reduzir o QA positivo imagem por imagem.

O fluxo canônico passa a ser:

`REFERENCIADOR → COLETOR/RELINKER → ASSIGNED_FOR_QA → QA REJEITA APENAS NÃO CONFORMES → FINALIZAR_QA → FROZEN`

Imagens externas novas não entram como patrimônio APPROVED da Biblioteca antes de sobreviver ao QA.

## Estado provisório do PRODUCTION_SLOT

Novo estado principal:

`ASSIGNED_FOR_QA`

Significa que:

- existe mídia ativa e materializada para inspeção;
- o slot está pronto para QA visual;
- o vínculo ainda é provisório para aquele projeto;
- o slot ainda não é FROZEN;
- uma candidata externa ainda não é APPROVED global.

Estados operacionais principais:

- `PENDING`: sem imagem;
- `ASSIGNED_FOR_QA`: imagem ativa provisória;
- `RELINK_REQUIRED`: imagem rejeitada, precisa substituição;
- `FROZEN`: sobreviveu ao QA e está aprovado definitivamente no projeto.

## Duas origens, um mesmo QA

### Asset já aprovado na Biblioteca

`assign_assets_to_slots` / `atribuir_assets_aos_slots` agora atribui AST aprovado como uso provisório:

- AST global continua APPROVED;
- bytes não são copiados;
- PSLOT vira `ASSIGNED_FOR_QA`;
- uso definitivo só é registrado no fechamento do QA;
- rejeitar o PSLOT não altera o AST global.

### Imagem externa nova

Nova rota:

`atribuir_candidatas_aos_slots_para_qa`

Aceita candidata `MATERIALIZED` e grava no PSLOT por `candidate_id`:

- `asset_id` permanece nulo antes do QA;
- candidata continua `MATERIALIZED`;
- objeto continua em mídia provisória/incoming quando aplicável;
- PSLOT vira `ASSIGNED_FOR_QA`;
- nenhuma promoção global acontece nesta etapa.

Isso separa explicitamente o vínculo provisório do patrimônio global da Library.

## Coletor e Relinker

O Coletor/Relinker:

1. usa Biblioteca primeiro quando houver AST adequado;
2. usa FAST PUSH/materialização para fontes externas quando necessário;
3. atribui uma única fonte ativa ao slot;
4. deixa candidatas extras como alternativas e não substitui silenciosamente um `ASSIGNED_FOR_QA` já ativo;
5. ao relinkar um `RELINK_REQUIRED`, retorna o slot para `ASSIGNED_FOR_QA`, nunca direto para FROZEN.

`COLLECTOR_FINISHED` só é marcado quando não restarem `PENDING` nem `RELINK_REQUIRED` e houver lote efetivamente abastecido para QA.

## QA por rejeição

Rota preferencial de leitura:

`obter_production_slots_para_qa`

Ela retorna somente `ASSIGNED_FOR_QA`, incluindo:

- `target_file`;
- origem `LIBRARY_ASSET` ou `EXTERNAL_CANDIDATE`;
- AST/candidate atual;
- preview temporário assinado do R2 para ambas as origens;
- ação operacional `REJECT_ONLY_IF_NONCONFORMING`.

O QA não aprova cada imagem boa. Para imagens ruins continua usando:

`rejeitar_production_slots_lote`

A rejeição atômica da 0.20.44 foi preservada e agora também registra a proveniência por `candidate_id` quando a origem ainda é externa.

Resultado da rejeição:

- somente o PSLOT selecionado vira `RELINK_REQUIRED`;
- `asset_id`/`candidate_id` ativo é removido;
- origem anterior é preservada em `previous_asset_id` / `previous_candidate_id` e histórico;
- AST global nunca é rejeitado;
- R2 global nunca é apagado;
- outros slots permanecem intactos.

## Finalização explícita do QA

Nova rota MCP:

`finalizar_qa_projeto`

Entrada:

- `projeto_id`;
- `operation_id` opcional;
- `finalizado_por` opcional.

A operação trabalha somente nos sobreviventes ainda `ASSIGNED_FOR_QA`.

### Sobrevivente vindo da Biblioteca

- PSLOT `ASSIGNED_FOR_QA → FROZEN`;
- AST existente é mantido;
- uso é registrado exatamente uma vez;
- nenhum AST duplicado é criado.

### Sobrevivente vindo de candidata externa

- candidata é promovida somente nesse momento;
- objeto definitivo é preparado em `assets/` quando necessário;
- AST determinístico é criado/reutilizado;
- candidata vira APPROVED e recebe `asset_id`;
- PSLOT recebe o AST e vira `FROZEN`;
- uso é registrado exatamente uma vez;
- fonte/proveniência permanece auditável.

### Rejeitados

`RELINK_REQUIRED` não é tocado por `finalizar_qa_projeto`.

## Atomicidade e idempotência da finalização

A finalização possui:

- preflight antes das escritas D1;
- AST determinístico para promoção externa;
- commit marker determinístico `PROJECT_QA_FINALIZED`;
- `operation_id` idempotente;
- guards de concorrência por slot;
- PSLOT, assets, candidata, histórico, uso, eventos, contagens e estado do projeto no mesmo `D1.batch()`;
- rollback D1 integral em falha;
- limpeza best-effort dos objetos R2 definitivos preparados antes de um rollback D1;
- retries seguros sem duplicar AST, uso ou eventos.

## Contagens

O modelo de produção passa a expor:

- `production_slots_total`;
- `production_slots_resolved`;
- `production_slots_assigned_for_qa`;
- `production_slots_frozen`;
- `production_slots_relink_required`;
- `production_slots_pending`.

`ready_for_qa` só é verdadeiro quando:

- não existem `PENDING`;
- não existem `RELINK_REQUIRED`;
- existe pelo menos um `ASSIGNED_FOR_QA`;
- todos os slots estão visualmente abastecidos.

`complete` / `qa_complete` só é verdadeiro quando todos os PSLOTs estão finais/FROZEN e não existem pendências de QA ou relink.

## Export final

`ASSIGNED_FOR_QA` não satisfaz mais o gate final do exportador.

Um projeto só pode ser considerado final para o pacote de imagens quando os slots necessários estiverem efetivamente FROZEN após o QA.

## Eventos

A release consolida os eventos:

- `PRODUCTION_SLOT_ASSIGNED_FOR_QA`;
- `PRODUCTION_SLOT_REJECTED`;
- `PRODUCTION_SLOT_RELINKED`;
- `PRODUCTION_SLOT_QA_APPROVED`;
- `PROJECT_QA_FINALIZED`;
- `ASSET_PROMOTED_AFTER_QA`;
- `ASSET_USAGE_REGISTERED`.

## Compatibilidade

Rotas antigas de aprovação positiva foram preservadas por compatibilidade, mas suas descrições MCP agora as classificam como `LEGADO/MANUAL` para evitar que agentes as escolham no fluxo padrão de PSLOT.

O caminho preferido passa a ser:

`obter_production_slots_para_qa → rejeitar_production_slots_lote → finalizar_qa_projeto`

## Schema

Schema D1: `2.26.0`

Migration: `9026_v2_qa_by_rejection.sql`

A migration adiciona vínculo provisório de candidata e metadados de QA sem apagar ou reconstruir o histórico existente. O executor de migration e o restore possuem a mesma proteção de reconciliação usada nos hotfixes anteriores para não reaplicar `ADD COLUMN` já satisfeito.
