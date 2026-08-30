# Corvo Library V2 — Checkpoint 0.20.2

## Factory Zero real

Este checkpoint foi preparado para uma nova Library. A migration `9012_v2_factory_zero_assets.sql` elimina qualquer conteúdo residual do D1 vivo mesmo quando as migrations de limpeza anteriores já foram executadas.

Estado esperado após a atualização:

- assets: 0;
- universos derivados: 0;
- usos: 0;
- projetos: 0;
- importações/candidatas/execuções/históricos: 0;
- settings/fontes/perfis/políticas recuperados: 0.

São preservados somente os componentes estruturais necessários para a infraestrutura existente: perfil/revisões de infraestrutura, schema e registry de migrations. O D1 e o bucket R2 não são recriados nem desconectados.

## R2

O bucket configurado continua o mesmo. A tarefa factory-zero remove somente prefixes gerenciados pela Corvo caso algum resíduo exista (`assets/`, `imports/`, `projects/`, `incoming/`, `batches/`, `exports/` e `corvo-core/recovery/`). O bucket em si e seu binding permanecem intactos.

## Importação e sincronização

Depois do reset, a primeira mídia real entra pela Library. O fluxo 0.20 continua disponível:

- ZIPs em lotes de até 48 MiB;
- upload navegador → Worker → R2;
- ID estável por SHA-256;
- deduplicação;
- manifesto/classificação;
- reconciliação R2 ↔ D1;
- catálogo, pendentes e rejeitados separados.

## Conectar MCP

Em **Configurações → Conectar MCP** existe um centro próprio para o GPT/cliente MCP:

- URL `https://<worker>.workers.dev/mcp` pronta para copiar;
- chave `CORVO_APP_KEY` pronta para copiar como Bearer;
- bloco completo de conexão;
- mostrar/ocultar chave;
- **Revogar e gerar nova**.

A rotação troca o secret no Worker através da API oficial de Workers Secrets; a chave anterior deixa de autenticar e a nova é salva somente no navegador atual. A chave não é persistida no D1.

## Gates

- Checkpoint: 0.20.2;
- Schema: 2.12.0;
- Validation: PASS;
- TypeScript frontend: PASS;
- TypeScript Worker: PASS;
- MCP: 244 tools únicas;
- FK violations: 0;
- erros: 0.

O `next build` real permanece um gate externo nesta execução porque o registry npm expirou antes de instalar dependências. O deploy normal executa `prebuild` e gera o bundle do Worker a partir das fontes deste checkpoint.
