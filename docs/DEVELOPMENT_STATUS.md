# Desenvolvimento contínuo — checkpoint 0.11

## Núcleo implementado

- D1 histórico restaurado 1:1; nenhuma conversão permanente de catálogo.
- R2 por binding nativo `MEDIA` no bucket `corvoquiz-prod`.
- Queue com retry limitado, concorrência limitada e DLQ.
- FAST PUSH assíncrono; MCP recebe ACK e não transporta mídia por URL.
- Upload direto atômico com recuperação de claims interrompidos.
- Catálogo, usos, pendentes, Inbox, lotes, solicitações, imports e projetos.
- FAST APPROVE idempotente e promoção de objetos para chave canônica `assets/...`.
- Auditoria D1↔R2 e integridade lógica D1.
- Workers com lease atômico, limites de capacidade, retry/backoff e watchdog.
- Supervisor com lease próprio, decisões, candidatos, circuit breaker e perfis de coleta.
- Proteção contra dados históricos órfãos: Dispatcher e Supervisor não os assumem nem os apagam.
- Políticas operacionais, estoque/giro, coleta automática, produção, ZIPs e downloads.
- Secrets separados: `CORVO_INTERNAL_KEY` (API) e `CORVO_SIGNING_KEY` (somente Worker).
- MCP stateless V2.

## MCP

- Ferramentas históricas: **229**.
- Implementadas com o mesmo nome: **227**.
- Substituídas por bindings seguros: **2** (`obter_configuracao_cloudflare`, `configurar_cloudflare`).
- Planejadas/faltantes por nome: **0**.
- Extras V2: `auditar_armazenamento_r2`, `auditar_integridade_d1`, `obter_status_upload_midia`.

`IMPLEMENTADO` garante presença no contrato MCP V2. Equivalência comportamental crítica é progressivamente coberta pelos gates e continua sendo validada antes do corte.

## Integridade 0.11

- `PRAGMA integrity_check`: PASS.
- Assets: 929 / 849 aprovados / 77 pendentes / 3 rejeitados.
- Universos aprovados: 174.
- Usos: 1.176.
- Assets sem `r2_key`: 0.
- `r2_key` compartilhadas: 8 grupos históricos preservados.
- Tabelas: 61 = 47 históricas + 14 `v2_*`.
- Schema V2: 2.6.0.
- Órfãos lógicos `v2_*`: **0**.
- 11.505 violações FK históricas são reproduzidas exatamente pelo backup e estão congeladas em `HISTORICAL_INTEGRITY_BASELINE.json`; aumento ou grupo novo falha o gate.
- Risco histórico ativo detectado: 54 worker jobs + 134 decisões + 60 candidatas de Supervisor sem item pai. Todos são preservados para auditoria e ignorados pelos fluxos V2.

## Gates

- Worker/Core structural typecheck: PASS.
- Frontend/BFF structural typecheck: PASS.
- Restauração + migrations 9000–9006: PASS.
- Paridade MCP: PASS (227 históricos registrados, 2 substituídos, 0 duplicados).
- Imports relativos/dependências legadas: PASS.
- `next build` real: PENDENTE por instalação de dependências/registry.
- Wrangler real/deploy: PENDENTE por dependências e provisionamento Cloudflare.

## Bloqueios externos

- Provisionar/vincular D1, Queue/DLQ e Worker na conta Cloudflare.
- Criar o projeto Vercel separado `corvo-library-v2`.
- Executar build real nos ambientes conectados antes de Production.


## Persistência de infraestrutura — 0.11

- Manifesto `v2_infrastructure_profiles` não secreto e singleton.
- Estado padrão `LOCKED`; deploy e reabertura só leem.
- Botão explícito `Alterar configuração` habilita edição local; salvar exige revisão esperada e confirmação explícita.
- Histórico imutável em `v2_infrastructure_config_events`.
- Gate prova que reaplicar migrations preserva o perfil byte a byte.
- `Verificar agora` só atualiza diagnóstico/`last_verified_at`.
- Badge do frontend atualizado para `V2 CORE 0.11`.
