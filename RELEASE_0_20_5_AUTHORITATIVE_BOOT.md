# Release 0.20.5 — Authoritative Boot

Correção do problema visual/arquitetural em que a aplicação podia exibir o estado antigo do D1 e, em seguida, atualizar para outro estado depois de uma cadeia de chamadas.

## Regra nova

**Nada é renderizado antes da fonte real responder.**

O boot usa uma única chamada de rede (`POST /bootstrap`). O Worker conclui internamente o reset one-shot, quando necessário, e devolve na mesma resposta:

- health real do Core;
- stats reais do catálogo;
- universos reais;
- primeira página real do catálogo;
- projetos reais;
- operações recentes reais;
- status final do Factory Zero.

A UI aplica esse snapshot de uma vez. O primeiro `useEffect` não chama mais `/health` e `/catalog/stats` em paralelo, e a conclusão do bootstrap não dispara imediatamente uma segunda recarga de catálogo/projetos.

## Segurança de dados

O reset é executado somente quando `factory_zero_release_0_20_5 != DONE`. Se o usuário importar assets depois disso, reloads não os apagam.
