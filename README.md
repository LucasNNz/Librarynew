# Corvo Library V2 — Checkpoint 0.19.0

Corvo Library V2 com **baseline CLEAN ZERO**. A interface continua no novo visual dark/React do 0.18, enquanto o catálogo recuperado do Legacy foi removido do bootstrap e a migration `9010_v2_clean_zero_baseline.sql` limpa o D1 existente sem apagar configurações.

## Clean Zero 0.19

Decisão operacional: começar o acervo novamente a partir das imagens baixadas do Legacy, em vez de continuar carregando registros recuperados que já não representam o bucket físico.

Ao aplicar a migration 9010 no D1 existente:

- assets, usos, lotes, projetos, candidatas, execuções, materializações, auditorias, logs e estados antigos são zerados;
- estados V2 transitórios (ingest, ZIPs, uploads, heartbeats, recovery events etc.) também são zerados;
- `settings`, fontes configuradas, perfis de fonte, limites de workers, políticas operacionais e o manifesto de infraestrutura são preservados;
- métricas históricas acumuladas dentro das tabelas de configuração são zeradas, mas a configuração em si permanece;
- `v2_infrastructure_profiles` e seus eventos não são alterados;
- nenhuma credencial é restaurada ou gravada no D1.

### R2

O bucket físico **não é apagado pela versão 0.19**. O bucket `corvoquiz-prod` já foi esvaziado externamente e continua sendo o mesmo bucket configurado. A migration remove jobs antigos de purge e grava apenas o marcador `CLEAN_ZERO_BASELINE = DONE` com `r2_action=NONE`.

Depois da primeira nova importação, a Library volta a produzir automaticamente os arquivos de recuperação em `corvo-core/recovery/`.

## Bootstrap novo

Instalações novas usam `bootstrap/CORVO_LIBRARY_V2_D1_CLEAN_BASELINE.sql.gz`, que contém schema histórico compatível + configurações seguras, **sem os 929 assets recuperados**. Depois são aplicadas as migrations V2.

Baseline validado após todas as migrations:

- Assets: 0
- Aprovados: 0
- Pendentes: 0
- Rejeitados: 0
- Usos: 0
- Projetos: 0
- Candidatas: 0
- Foreign-key violations: 0
- Schema: 2.10.0
- Data baseline: `CLEAN_ZERO`

Configuração preservada no bootstrap de validação:

- `settings`: 39
- `collection_sources`: 22
- `source_profiles`: 4
- `worker_capacity_limits`: 11
- `operational_policies`: 7 depois das migrations

## MCP / Heartbeats

O MCP permanece intacto: 229 ferramentas históricas na matriz (227 implementadas + 2 substituídas por bindings) e 17 ferramentas V2 extras, totalizando 244 registros únicos. Heartbeats de Worker, Supervisor e Operação continuam ativos.

## UI

A interface mantém o sprint visual 0.18:

- sidebar curta: Visão geral, Assets, Projetos, Execuções, Análise e Configurações;
- Assets: Catálogo, Pendentes e Rejeitados;
- dashboard React/SVG de agentes e projetos;
- visual dark premium e ícones vetoriais;
- estados vazios passam a representar de fato uma biblioteca nova.

## Segurança da transição

A migration 9010 foi testada sobre uma restauração completa da base antiga: `929 -> 0` assets e `1176 -> 0` usos, com 0 violações de FK. Também foi testada com um perfil de infraestrutura salvo e uma configuração customizada; ambos permaneceram byte-for-byte/valor-for-valor após a limpeza.
