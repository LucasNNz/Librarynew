# Assistente de infraestrutura — Corvo Library V2 0.11


## Modo rápido recomendado

A tela principal não pede nomes de recursos nem credenciais R2. O fluxo é:

1. Execute uma única vez `npm run setup:cloudflare` na raiz do projeto.
2. O instalador cria/verifica D1, Queue e DLQ, confirma o bucket existente `corvoquiz-prod`, gera secrets, aplica migrations e publica o Worker. Se `CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql` estiver ao lado do projeto, restaura o catálogo histórico automaticamente.
3. Copie apenas `CORVO_CORE_URL` e `CORVO_INTERNAL_KEY` exibidos pelo instalador para as variáveis persistentes da Vercel.
4. Volte ao app e clique **Verificar e travar**.

As opções de nomes de Worker/D1/R2/Queue ficam escondidas em **Mostrar opções avançadas**.
A tela **Configurações** segue a regra **configure uma vez, preserve para sempre**.

## Contrato de persistência

1. Os secrets e bindings vivem no provedor correto:
   - Vercel: `CORVO_CORE_URL` e `CORVO_INTERNAL_KEY`.
   - Cloudflare Worker: `CORVO_INTERNAL_KEY`, `CORVO_SIGNING_KEY`, `DB`, `MEDIA`, `MATERIALIZE_QUEUE`.
2. O D1 guarda somente um manifesto **não secreto** em `v2_infrastructure_profiles`.
3. O manifesto nasce com `revision=1` e `lock_state=LOCKED`.
4. Reabrir o app, reiniciar Worker ou publicar nova versão **não altera** o manifesto.
5. As migrations usam somente `CREATE TABLE IF NOT EXISTS` para essa configuração; elas não fazem seed, reset ou `INSERT OR REPLACE` do perfil.
6. Alteração só ocorre pelo botão **Alterar configuração** e cria uma nova revisão com evento de auditoria.
7. O backend exige `expectedRevision` + `confirmChange=true`; isso impede alteração silenciosa, aba antiga ou duas edições concorrentes.

## Etapas

1. **Vercel BFF**
   - `CORVO_CORE_URL`
   - `CORVO_INTERNAL_KEY`
2. **Cloudflare Worker secrets**
   - `CORVO_INTERNAL_KEY` (mesmo valor do BFF)
   - `CORVO_SIGNING_KEY` (exclusiva do Worker)
3. **Bindings do Worker**
   - `DB` → D1 da Corvo Library
   - `MEDIA` → R2 `corvoquiz-prod`
   - `MATERIALIZE_QUEUE` → fila FAST PUSH
   - DLQ → `corvo-materialize-v2-dlq`
4. **Banco**
   - restaurar o dump histórico uma única vez
   - aplicar migrations `9000+`
5. **Manifesto persistente**
   - confirmar nomes dos recursos
   - clicar **Salvar e travar configuração**
6. **Verificação**
   - botão `Verificar agora`
   - a verificação atualiza apenas `last_verified_at`; não reconfigura nada

## Segurança

O manifesto contém apenas nomes e identificadores operacionais não secretos. Não há colunas para token, senha, Access Key, Secret Key ou master key.
