# Corvo Library V2 — Fundação

## Regra estrutural

- **D1** = catálogo, estado, filas lógicas, projetos, usos, candidatos, políticas.
- **R2** = bytes de mídia. Nenhum segredo R2 é gravado em D1.
- **Cloudflare Queue** = desacopla FAST PUSH da materialização.
- **Corvo Core Worker** = única camada que possui bindings D1/R2/Queue.
- **Vercel** = UI + BFF. Não conhece credenciais R2; conhece apenas `CORVO_CORE_URL` + uma chave interna do Core.
- **MCP** = chama o Corvo Core e recebe ACK de operação. Não transporta a mídia quando recebe uma URL.

## FAST PUSH

1. Cliente/MCP envia URLs + metadados para `/fast-push`.
2. Core cria `operations` e `candidates` no D1.
3. Core responde `202` com `operationId` imediatamente.
4. Queue recebe um job por URL.
5. Consumidor baixa a mídia e grava direto no R2.
6. D1 recebe apenas estado, metadados e `r2_key`.
7. `/operations/:id` mostra progresso.

## Princípios anti-regressão

- Sem seed de produção embutido no app.
- Sem fallback que simule bucket configurado.
- Sem configuração criptografada dependente do token do banco.
- `MISSING`, `LOCKED`, `UNAVAILABLE` e `MISCONFIGURED` nunca são tratados como o mesmo estado.
- Deploy da UI não altera D1/R2.
- Deploy do Core não executa bootstrap destrutivo.
