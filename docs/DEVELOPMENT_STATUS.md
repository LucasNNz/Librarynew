# Development Status — Corvo Library V2 0.17.0

## UI 0.17

- visual shell redesenhado
- dashboard Visão geral funcional
- sidebar reduzida a seis módulos
- Assets consolidado com Catálogo/Pendentes/Rejeitados
- módulos técnicos agrupados por função
- responsividade revisada
- backend, D1, R2, Queue, MCP e heartbeat preservados

## Núcleo
- D1 histórico restaurável 1:1: PASS.
- R2 `corvoquiz-prod` por binding: implementado.
- Queue/DLQ + materialização: implementado.
- Setup web autossuficiente: implementado.
- Persistência de configuração entre deploys: protegida por gate.

## Heartbeats 0.16

- Worker/Supervisor possuem heartbeat MCP explícito e renovação atômica do lease.
- Operações longas possuem heartbeat genérico com owner/execution e expiração controlada.
- Watchdogs passam a refletir expiração também em `v2_runtime_heartbeats`.

## Operação 0.15
- Bulk select / approve / permanent delete: implementado.
- ZIP de assets em massa + link temporário: implementado.
- R2 pending reconciliation: implementado.
- Exclusão dos Pendentes `NOT_FOUND` após fresh scan: implementado.
- Projetos históricos: purgados; backfill legado desativado.
- Prefixo R2 `projects/`: manutenção automática de purge.
- Supervisor policy autonomy: implementada via MCP.
- Recovery manifests/sidecars/tombstones no R2: implementados.

## Gates
- D1 integrity: PASS.
- Historical baseline: PASS.
- V2 logical orphans: 0.
- Structural TypeScript — Core: PASS.
- Structural TypeScript — Frontend: PASS.
- MCP historical compatibility: 227 implementadas + 2 substituídas.
- Gates vivos de Vercel/Cloudflare continuam dependentes do ambiente implantado.