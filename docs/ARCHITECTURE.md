# Corvo Library V2 — Arquitetura autossuficiente

## Regra estrutural

- **D1** = catálogo, estado, filas lógicas, projetos, usos, candidatos e políticas.
- **R2** = bytes de mídia; o bucket oficial continua `corvoquiz-prod`.
- **Cloudflare Queue** = desacopla FAST PUSH da materialização.
- **Corvo Core Worker** = camada operacional com bindings D1/R2/Queue.
- **Frontend web** = interface. Não precisa conhecer Access Key/Secret do R2 nem receber Environment Variables para localizar o Core.
- **MCP** = chama o Core e recebe ACK de operação. Não transporta mídia quando recebe uma URL.

## Primeira configuração

```text
Interface
  │ usuário cola API Token Cloudflare uma vez
  ▼
Setup same-origin
  ├─ D1 create/find
  ├─ R2 verify corvoquiz-prod
  ├─ Queue/DLQ create/find
  ├─ gera app/internal/signing keys
  ├─ publica Worker com bindings
  └─ importa D1 histórico + migrations
          │
          ▼
     Corvo Core ONLINE
```

Após o provisionamento:

- `CLOUDFLARE_CONTROL_TOKEN` fica como **secret do Worker**;
- `CORVO_INTERNAL_KEY`, `CORVO_APP_KEY` e `CORVO_SIGNING_KEY` ficam como **secrets do Worker**;
- o navegador guarda somente `coreUrl`, `appKey` e identificadores não secretos da instalação;
- D1 guarda o manifesto `v2_infrastructure_profiles`, sem segredo.

## FAST PUSH

1. Cliente/MCP envia URLs + metadados para `/fast-push`.
2. Core cria operação/candidatas no D1.
3. Core responde `202` com `operationId`.
4. Queue recebe jobs.
5. consumidor baixa a mídia e grava no R2.
6. D1 recebe estado, metadados e `r2_key`.
7. `/operations/:id` mostra progresso.

## Atualizações

O frontend e o Core têm ciclos independentes. O Core possui um token de controle próprio e uma origem confiável do app (`CORVO_APP_ORIGIN`). Quando necessário, `/control/update-core` busca o bundle da versão publicada no app e atualiza o Worker mantendo os bindings e secrets existentes. O endpoint não aceita código arbitrário fornecido pelo navegador.

## Princípios anti-regressão

- Sem seed de produção embutido no runtime.
- O dump histórico só existe como bootstrap de primeira instalação.
- Sem fallback que finja bucket configurado.
- Sem configuração criptografada dependente do token do banco.
- `MISSING`, `LOCKED`, `UNAVAILABLE` e `MISCONFIGURED` são estados diferentes.
- deploy do frontend não altera D1/R2.
- migrations não sobrescrevem o manifesto de infraestrutura.
- alteração de infraestrutura exige ação explícita e nova revisão.
