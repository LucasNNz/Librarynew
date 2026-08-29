# Corvo Library V2 — checkpoint 0.12.2

Reconstrução limpa da Corvo Library com **UI web** + **Cloudflare Worker (Core)** + **D1 + R2 + Queue**, com configuração autossuficiente pela própria interface.

A V2 usa a V61.9 como especificação funcional e preserva o banco histórico 1:1. Não usa Turso/libSQL, `production-recovery`, `secret_cloudflare_connection` nem credenciais R2 salvas no D1.

## Arquitetura

```text
Corvo Library (web)
        │
        │ app key local de baixo privilégio
        ▼
Cloudflare Worker / MCP
  ├─ D1       catálogo + estado
  ├─ R2       mídia (corvoquiz-prod)
  ├─ Queue    materialização assíncrona
  └─ secrets  controle/assinatura
        ↓
       DLQ
```

O frontend pode continuar hospedado na Vercel, mas **não depende de Environment Variables da Vercel para operar a Library**. Depois do setup, o navegador fala diretamente com o Corvo Core usando uma chave própria da aplicação. O token Cloudflare nunca é salvo no D1 nem no `localStorage`; após a primeira configuração ele existe somente como secret do Worker.

## Configuração autossuficiente — 0.12.2

A tela **Configurações** executa o provisionamento pela API oficial da Cloudflare. O usuário informa um API Token uma única vez e o app:

1. localiza/cria o D1 `corvo-library-v2`;
2. confirma e reutiliza o bucket R2 existente `corvoquiz-prod`;
3. localiza/cria Queue e DLQ;
4. gera as chaves internas;
5. publica o Worker `corvo-core-v2` com bindings nativos;
6. restaura o banco histórico embutido no app e aplica migrations V2;
7. grava a conexão deste navegador;
8. cria o manifesto não secreto `LOCKED` no D1.

Nenhum Wrangler/npm precisa ser instalado no computador do usuário e nenhuma variável manual precisa ser adicionada na hospedagem.

### Persistência

- fechar e abrir o app preserva a conexão;
- redeploy do frontend preserva a conexão;
- migrations não fazem seed/reset do manifesto;
- uma alteração explícita cria uma nova revisão;
- a configuração Cloudflare permanece nos próprios recursos/Worker;
- se o armazenamento local do navegador for limpo, **reconectar** usa novamente um API Token e reaproveita os recursos existentes, sem restaurar/copiar mídia novamente.

### Atualização do Core

O Worker guarda o token de controle como secret e conhece a origem do app. Quando uma versão futura do frontend exigir um Core novo, a tela pode pedir ao Worker para buscar o bundle publicado pelo próprio app e atualizar **o próprio Worker**, preservando D1/R2/Queue e os secrets. Isso evita uma nova configuração manual a cada release.

## Estado funcional

- Restauração histórica: **929 assets**, **849 aprovados**, **77 pendentes**, **3 rejeitados**, **174 universos aprovados**, **1.176 usos**.
- 47 tabelas históricas preservadas + 14 tabelas `v2_*`; schema V2 **2.7.0**.
- FAST PUSH URL → ACK → Queue → R2 → D1 → Inbox.
- Upload direto sem binário no MCP.
- Catálogo, projetos, solicitações, lotes/imports, Supervisor, workers, coleta, políticas, estoque, pacotes/ZIP e auditoria D1↔R2.
- **227/229** nomes MCP históricos implementados; os 2 restantes foram substituídos pela infraestrutura segura da V2.

## Segurança

O D1 não recebe token Cloudflare, Access Key, Secret Key, signing key ou master key. A credencial Cloudflare de controle é movida para um secret do Worker após o setup; o navegador conserva apenas `coreUrl` + `appKey` de aplicação para a sessão persistente da Library.

Veja `docs/SETUP_WIZARD.md`, `docs/ARCHITECTURE.md` e `docs/DEPLOYMENT_RUNBOOK.md`.


## Build fix — 0.12.2

O bundle do Worker é gerado no `prebuild` da Vercel. Dependências do MCP/Agents usam APIs nativas do runtime Cloudflare, incluindo `node:async_hooks`. O esbuild agora usa `platform: "neutral"` e preserva imports `node:*` como externos, em vez de tentar resolvê-los como browser modules durante o build da Vercel. O Worker é publicado com compatibility date `2026-08-29`, que fornece a compatibilidade Node necessária no runtime Cloudflare.

## Build fixes — 0.12.2

### Post-prebuild TypeScript regression
`generated-core-bundle.ts` now exports the generated version and source as explicit `string` values. This prevents TypeScript from narrowing the generated version to the literal checkpoint value and rejecting the defensive `UNBUILT` comparison during `next build`. The checkpoint gate simulates the post-prebuild generated file before packaging.
