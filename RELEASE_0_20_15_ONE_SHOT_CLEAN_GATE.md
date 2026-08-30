# Corvo Library V2 0.20.15 — One-Shot Clean Gate

## Correção

O frontend executava `operational-clean-once` em todo boot. O Core já era idempotente: após a limpeza inicial, retornava `idempotent: true` e preservava qualquer asset/projeto criado posteriormente. Porém o frontend continuava exigindo `assets === 0` e `projects === 0`, causando bloqueio com mensagens como `OPERATIONAL_CLEAN_VERIFICATION_FAILED:40/0` depois da primeira importação.

Agora:

- zero é obrigatório apenas quando a limpeza one-shot está realmente sendo executada pela primeira vez;
- quando o marcador `operational_clean_release_0_20_10` já está `DONE`, as contagens atuais são tratadas como dados reais válidos;
- a verificação final de D1 vazio também só roda durante a limpeza inicial;
- boots posteriores carregam catálogo/projetos reais normalmente;
- nenhuma exclusão, migration ou alteração de schema foi adicionada.

## Preservado

- fila de múltiplos ZIPs;
- upload R2 com comprimento conhecido;
- download de export corrigido;
- MCP do ChatGPT público e sem autenticação;
- autenticação das demais rotas do Core.
