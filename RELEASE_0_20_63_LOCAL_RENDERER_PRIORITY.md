# Release 0.20.63 — prioridade para renderer local com fallback Browser Run

## Objetivo
Quando houver pelo menos uma aba do Library aberta em qualquer PC, o Quiz passa a priorizar a execução local no navegador. O Browser Run da Cloudflare continua como fallback para os casos em que não houver nenhuma aba ativa ou quando o renderer local não assumir o job dentro da janela de prioridade.

## O que mudou
- novo **renderer local invisível** carregado no layout do app;
- heartbeat e claim de jobs de Quiz diretamente do navegador aberto;
- `renderer_status` e `quiz catalog` agora expõem **`LOCAL_FIRST`**;
- `renderer.mode` passa a reportar **`LOCAL_BROWSER`** quando existir aba ativa do Library;
- Browser Run ganhou uma **janela de prioridade** antes de assumir o job, dando preferência ao renderer local;
- resultados de jobs executados localmente passam a ser marcados com `renderer: LOCAL_BROWSER`.

## Regra operacional
1. Há aba ativa do Library em algum PC → o renderer local tenta pegar os jobs primeiro.
2. Não há aba ativa → o Browser Run continua processando normalmente.
3. Se houver aba ativa mas ela não assumir o job dentro da janela de prioridade, o fallback pode assumir para evitar fila travada.

## Compatibilidade
- schema permanece em **2.29.0**;
- o source ZIP continua distribuído com `lib/generated-core-bundle.ts` em `UNBUILT`, para o bundle do Worker ser regenerado no `prebuild` do deploy.
