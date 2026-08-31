# Release 0.20.48 — Project List UX + Modern Scrollbars

## Objetivo
Eliminar scrollbars nativos claros/obstrutivos da interface e impedir que projetos concluídos compartilhem a mesma fila operacional dos projetos pendentes.

## Mudanças

### Scrollbars
- estilo global fino e escuro para Chromium/WebKit e Firefox;
- `::-webkit-scrollbar-button` removido;
- `scrollbar-gutter: stable` nas listas verticais principais;
- navegações horizontais (`moduleTabs`, `primaryNav`, `projectRailTabs`) continuam roláveis, mas sem uma barra visual ocupando espaço;
- `body`, `workspace` e `content` não propagam overflow horizontal acidental;
- `projectCardList` aceita apenas scroll vertical e mantém gutter à direita.

### Painel de ações de projetos
O bloco de ações em lote passa a usar grid 2×2. Botões longos como **Excluir permanentemente** não aumentam mais a largura do rail, eliminando a barra horizontal que podia ocultar controles.

### Separação de projetos
- default: `ACTIVE / Em andamento`;
- `Pendentes 24h`: somente `ACTIVE` recentes;
- `Concluídos`: somente lifecycle `COMPLETED`;
- `Rejeitados`: somente lifecycle `REJECTED`;
- o alias interno `ALL` passa a significar fila operacional ativa, preservado apenas por compatibilidade;
- trocar de grupo limpa a seleção em lote;
- `Concluir` e `Rejeitar` não são exibidos em Concluídos/Rejeitados.

## Compatibilidade
- sem migration D1; schema `2.26.0`;
- Core/App version `0.20.48`;
- fluxo 0.20.47 de THUMB preservado;
- QA por rejeição e pós-QA preservados.
