# Release 0.20.55 — Auth Recovery + Settings Bypass

## Problema corrigido

Um navegador com conexão salva podia receber `UNAUTHORIZED` depois que outra instalação republicava o mesmo Worker com novas chaves. A UI tratava esse `401` como “Não foi possível ler o D1” e escondia toda a área de Configurações, impedindo o próprio diagnóstico e recuperação.

## Mudanças

1. **Configurações fora do gate D1**
   - Configurações continua acessível quando o boot autoritativo falha.
   - `SESSION_UNAUTHORIZED` é classificado como falha de sessão, não de D1.
   - A tela oferece recuperação específica do navegador.

2. **Sessões independentes por navegador**
   - O Core emite `DEVICE_TOKEN_V1` assinado por HMAC com `CORVO_INTERNAL_KEY`.
   - Tokens carregam `deviceId`, emissão e expiração.
   - O auth aceita tanto tokens novos quanto `CORVO_APP_KEY` legado.
   - Não há consulta D1 para autenticar o token.

3. **Recuperação segura**
   - `POST /api/setup/cloudflare/recover-browser` recebe um Cloudflare API Token do administrador.
   - Atualiza somente `CLOUDFLARE_CONTROL_TOKEN`.
   - Se necessário publica o bundle atual usando `keep_bindings`, preservando D1/R2/Queue e secrets já existentes.
   - Em seguida chama `POST /control/pair-browser` e salva apenas o novo token do navegador.

4. **Setup multi-PC idempotente**
   - Se o Worker já existe, o setup não gera novamente `CORVO_APP_KEY`, `CORVO_INTERNAL_KEY` ou `CORVO_SIGNING_KEY`.
   - Ele preserva bindings e apenas emparelha o novo navegador.
   - Em instalações novas, os secrets são criados uma vez e o primeiro navegador já recebe um token por dispositivo.

5. **Diagnóstico sem D1**
   - `GET /version` ocorre antes do auth e não lê D1.
   - Retorna somente versão, contrato de schema e modo de autenticação, sem expor secrets.

## Compatibilidade

- D1 schema: 2.27.0 (sem migration nova).
- R2/Queue: inalterados.
- MCP público `/mcp`: inalterado.
- Sessões legadas continuam válidas enquanto o `CORVO_APP_KEY` atual não for alterado.
