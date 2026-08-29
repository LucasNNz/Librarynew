# Corvo Library V2 — checkpoint 0.11

Reconstrução limpa da Corvo Library com **Vercel (UI/BFF)** + **Cloudflare Worker (Core)** + **D1 + R2 + Queue**.

A V2 usa a V61.9 como especificação funcional e preserva o banco histórico 1:1. Não usa Turso/libSQL, `production-recovery`, `secret_cloudflare_connection` nem credenciais R2 salvas no banco.

## Arquitetura

```text
Vercel UI/BFF
     ↓ CORVO_INTERNAL_KEY
Cloudflare Worker / MCP
  ├─ D1       catálogo + estado
  ├─ R2       mídia (corvoquiz-prod)
  └─ Queue    materialização assíncrona
        ↓
       DLQ

Worker-only: CORVO_SIGNING_KEY → URLs temporárias
```

## Checkpoint 0.11

- Restauração histórica: **929 assets**, **849 aprovados**, **77 pendentes**, **3 rejeitados**, **174 universos aprovados**, **1.176 usos**.
- 47 tabelas históricas preservadas + 14 tabelas `v2_*`; schema V2 **2.6.0**.
- FAST PUSH URL → ACK → Queue → R2 → D1 → Inbox.
- FAST APPROVE e aprovação de candidatas endurecidos para retry/idempotência e promoção `incoming/ → assets/`.
- Upload direto com claim atômico: `PREPARED → UPLOADING → STORED → CONFIRMING → CONFIRMED`, recuperação de claim travado e sem binário no MCP.
- Catálogo, projetos, solicitações, lotes/imports, Supervisor, workers, coleta, políticas, estoque, pacotes/ZIP e auditoria D1↔R2.
- Dispatcher ignora jobs históricos órfãos; Supervisor ignora decisões/candidatas órfãs, sem apagar o histórico.
- Integridade lógica exposta em `/data-health` e `auditar_integridade_d1`.
- Chave de assinatura separada da chave interna de API.
- **227/229** nomes MCP históricos implementados; os outros **2** são substituídos pelos bindings Cloudflare seguros.
- 3 ferramentas extras V2 de diagnóstico/upload.


### Configuração persistente 0.11

A tela **Configurações** agora possui um manifesto persistente de infraestrutura:

- a configuração é salva uma única vez e fica `LOCKED`;
- cada alteração explícita cria uma nova revisão e evento de auditoria;
- migrations/redeploys não fazem seed nem overwrite do manifesto;
- o gate reaplica todas as migrations sobre uma configuração-sentinela e exige preservação byte a byte;
- secrets continuam exclusivamente no Vercel/Cloudflare, nunca no D1;
- `Verificar agora` testa bindings sem reconfigurar nada.

## Gate 0.11

O script `scripts/validate-checkpoint.py` executa restauração completa + todas as migrations, compara a dívida histórica com um baseline imutável, exige zero órfãos V2, valida paridade MCP, imports relativos, dependências proibidas, typechecks estruturais e o contrato de persistência da configuração.

Resultado atual: **PASS**, incluindo o teste de persistência da configuração.

O `next build` real e o build/typecheck com dependências reais de Wrangler continuam como gates externos porque o registry não concluiu a instalação nesta execução.

Veja `docs/DEPLOYMENT_RUNBOOK.md` para provisionamento e corte.
