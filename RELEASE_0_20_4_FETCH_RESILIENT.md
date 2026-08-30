# Corvo Library V2 — 0.20.4 FETCH RESILIENT

Correção dirigida ao erro `Factory Zero precisa de atenção — Failed to fetch` observado durante a atualização automática do Core.

## Causa corrigida
O Worker pode ser temporariamente desconectado enquanto substitui a própria versão. O gate 0.20.3 interpretava essa janela transitória como falha definitiva.

## Alterações
- retry de rede com backoff para health, migrations e status do Factory Zero;
- a resposta do self-update pode ser perdida sem abortar o fluxo: a versão é confirmada por health;
- POST do Factory Zero é reconciliado pelo marcador no D1 antes de qualquer repetição;
- verificação final exige `required=false`, `assets=0` e `projects=0`;
- refresh visual pós-reset usa `Promise.allSettled`, portanto falha de UI não vira falso erro de limpeza;
- CORS do Worker inclui PATCH/HEAD, cache de preflight e `Vary: Origin`;
- nenhuma configuração D1/R2 é removida;
- o marcador de limpeza continua sendo o one-shot `factory_zero_release_0_20_3`, evitando nova limpeza após a primeira confirmação.
