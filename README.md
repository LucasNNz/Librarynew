# Corvo Library V2 — Checkpoint 0.17.0

## Novo no 0.17 — interface operacional premium

- Nova **Visão geral** com KPIs reais, agentes, projetos, saúde e atividade recente.
- Sidebar consolidada em **Visão geral · Assets · Projetos · Execuções · Análise · Configurações**.
- **Assets** agora contém Catálogo, Pendentes e Rejeitados como abas internas.
- Projetos agrupa Solicitações/Lotes/Importações; Execuções agrupa Coleta/Inbox/Operação; Análise agrupa Estoque/Políticas.
- Linguagem visual dark premium inspirada no painel Corvo aprovado.
- Cards de mídia com fallback visual limpo quando o arquivo físico não responde.
- Todas as ações reais existentes continuam disponíveis: ZIP, aprovação, exclusão permanente, reconciliação R2, FAST PUSH, Supervisor, políticas e heartbeats.
- Nenhuma migration nova: schema continua **2.9.0**.

Corvo Library V2 limpa e autossuficiente: Vercel para a interface e Cloudflare Worker + D1 + R2 + Queue para o Core. Sem Turso, sem `production-recovery`, sem credenciais R2 salvas no D1 e sem instalação local obrigatória.

## Novo no 0.16 — Heartbeat MCP e leases renováveis

- `heartbeat_worker`: renova lease somente com `work_item_id + worker_id + execution_id` corretos; lease expirado não é ressuscitado.
- `heartbeat_supervisor`: renova projeto/execução atual do Supervisor e rejeita owner/execution divergente.
- `heartbeat_operacao`: heartbeat para orquestrações MCP longas com ownership explícito e takeover de expirado somente com `reclaim_expired=true`.
- `obter_status_heartbeats`: mostra último sinal, expiração e tempo restante.
- `executar_watchdog_heartbeats`: expira registros genéricos; watchdogs nativos continuam requeue/abandono de Worker/Supervisor.
- Migration `9009_v2_runtime_heartbeats.sql` adiciona apenas estado V2; nenhuma tabela histórica é remodelada.

## Novo no 0.15 — operação real, limpeza histórica e recuperação pelo R2

- Seleção múltipla no Catálogo/Pendentes/Rejeitados.
- Geração de ZIP em massa no R2 com download por URL temporária.
- Aprovação em lote de Pendentes.
- Exclusão permanente em lote: remove metadados do D1 e remove o objeto R2 quando ele existir e não estiver compartilhado por outro asset.
- `Vasculhar pendentes no R2`: procura o arquivo físico; correspondências fortes podem ser religadas mantendo o status Pendente.
- `Excluir não encontrados`: refaz uma varredura completa no momento da ação; só depois remove os Pendentes que continuarem `NOT_FOUND`. A política passa a ser recapturar mídia nova, não insistir indefinidamente.
- Projetos históricos e seu estado de Supervisor/Workers foram removidos do D1 por decisão operacional. A manutenção V2 também limpa o prefixo físico `projects/` no R2. Novos projetos começam limpos na V2.
- Supervisor MCP pode criar políticas livres em qualquer escopo, ativar, versionar, suspender, substituir e fazer rollback. A UI não limita a autoria operacional da IA.
- Todo fluxo novo de imagem/import grava material de recuperação no R2:
  - `corvo-core/recovery/D1_STRUCTURE.json`
  - `corvo-core/recovery/assets/<AST>.json`
  - `corvo-core/recovery/candidates/<id>.json`
  - `corvo-core/recovery/imports/<id>.json`
  - `corvo-core/recovery/deleted/assets/<AST>.json` para tombstones `DO_NOT_RESTORE`.
- A estrutura/sidecars nunca armazenam tokens, passwords ou Access Keys.

## MCP

A matriz histórica continua com 229 ferramentas: 227 implementadas e 2 antigas de credencial Cloudflare substituídas por bindings nativos. A V2 acrescenta ferramentas operacionais próprias, incluindo ZIP de assets, link/status de ZIP, reconciliação R2, exclusão dos Pendentes não encontrados, auditoria de armazenamento e política livre do Supervisor.

## Estado validado do banco

O gate 0.15 restaura a base histórica e aplica todas as migrations V2 em memória antes de aprovar o checkpoint. Baseline: 929 assets, 849 aprovados, 77 pendentes, 3 rejeitados, 174 universos aprovados e 1.176 usos. Projetos históricos após a migration 9008: zero.

## Princípios de segurança

A configuração de infraestrutura é persistente e imutável por padrão. Atualizações não resetam bindings/configuração. Exclusão permanente exige confirmação explícita. Objetos R2 compartilhados por mais de um asset não são apagados automaticamente. Uma varredura truncada do R2 bloqueia a exclusão automática de Pendentes não encontrados.