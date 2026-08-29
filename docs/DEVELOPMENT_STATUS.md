# Desenvolvimento contínuo — status

## Núcleo concluído nesta fase

- D1 histórico restaurável 1:1.
- R2 via binding nativo `MEDIA`.
- Queue de materialização assíncrona.
- FAST PUSH por URL com ACK rápido.
- Inbox de candidatas.
- Aprovação/rejeição de candidatas.
- Catálogo com busca, universo, status, tipo e nunca usado.
- Preview/download com URL HMAC temporária, sem credencial R2.
- Registro de uso e histórico.
- Aprovação/rejeição/restauração de assets.
- Solicitações e lotes básicos.
- Manifesto de lote no R2.
- MCP stateless V2 com nomes históricos preservados.
- Gate de consistência D1↔R2 e detecção de `r2_key` compartilhado.

## MCP

- Catálogo histórico: 229 ferramentas.
- Implementadas atualmente: consultar `docs/MCP_COMPATIBILITY_MATRIX.md` (gerado automaticamente).
- `configurar_cloudflare` e `obter_configuracao_cloudflare` são deliberadamente substituídas por bindings; não serão reintroduzidas como formulário de segredo no banco.

## Bloqueios externos atuais

- O projeto Vercel separado `corvo-library-v2` ainda precisa ser criado/vinculado antes do deploy; não publicar sobre o projeto `vercel` existente.
- A conta Cloudflare não está conectada como ferramenta nesta sessão, portanto D1/R2/Queue reais não foram criados nem mutados.
- `npm install` no container de desenvolvimento expirou por timeout de rede; a validação completa de build deve ocorrer no build da Vercel/Cloudflare quando os projetos forem vinculados.
