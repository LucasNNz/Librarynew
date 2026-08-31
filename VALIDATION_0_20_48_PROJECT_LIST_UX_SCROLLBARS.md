# Validation 0.20.48 — Project List UX + Modern Scrollbars

## Resultado
PASS.

## Gates executados
- TypeScript estrutural frontend (`tsc -p tsconfig.validate.json`): PASS;
- TypeScript estrutural Core (`tsc -p cloudflare/tsconfig.validate.json`): PASS;
- behavior gate 0.20.48: **31/31 PASS**;
- balanceamento estrutural do CSS: PASS;
- schema D1: permanece `2.26.0`; nenhuma migration adicionada;
- hotfix THUMB 0.20.47 preservado.

## UX verificada pelo gate
- default da lista = `ACTIVE / Em andamento`;
- `Pendentes 24h` exige lifecycle `ACTIVE`;
- `COMPLETED` aparece somente em `Concluídos`;
- `REJECTED` aparece somente em `Rejeitados`;
- troca de aba limpa seleção em lote;
- ações de concluir/rejeitar não aparecem nas áreas concluída/rejeitada;
- scrollbar WebKit customizada;
- scrollbar Firefox customizada;
- botões nativos de scrollbar removidos;
- scrollbars de navegação horizontal ocultos visualmente;
- `projectCardList` sem overflow horizontal;
- gutter vertical estável;
- bulk actions em grid 2×2 sem expansão horizontal;
- overflow horizontal acidental da página bloqueado.

## Observação de build
O checkpoint não contém `node_modules`; o gate usado é o typecheck estrutural com stubs do próprio projeto, como nos checkpoints recentes. O `prebuild` continua responsável por gerar o Core bundle exato 0.20.48 após instalação das dependências.
