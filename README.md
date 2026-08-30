# Corvo Library V2 0.20.13 — R2 Known-Length Upload

Corrige a falha de upload de lotes ZIP no R2 causada por um `TransformStream`
sem comprimento conhecido. O upload direto agora preserva o `request.body` original
quando `Content-Length` existe e usa um buffer limitado quando não existe.

A fila de múltiplos ZIPs do 0.20.11 e o MCP público sem autenticação do 0.20.12
continuam preservados.

Veja `RELEASE_0_20_13_R2_KNOWN_LENGTH_UPLOAD.md`.

# Histórico: Corvo Library V2 0.20.9 — Dynamic Clean Recovery

Esta versão corrige a exceção do Worker causada pela limpeza SQL fixa da
0.20.8. O app atualiza o Core primeiro e usa um endpoint idempotente que descobre
as tabelas realmente existentes no D1 antes de limpá-las. Instalações legadas
com schemas diferentes não executam mais `DELETE` contra tabelas ausentes.

Veja `RELEASE_0_20_9_DYNAMIC_CLEAN_RECOVERY.md`.

# Histórico: Corvo Library V2 0.20.8 — Clean Once

Esta versão limpa uma única vez todos os dados operacionais persistidos no D1
(assets, projetos, execuções, filas e históricos), inclusive quando o bucket R2
já está vazio. A configuração de infraestrutura é preservada, assim como a
chave salva no navegador e os secrets/token guardados no Worker.

Veja `RELEASE_0_20_8_CLEAN_ONCE.md`.

# Histórico: Corvo Library V2 0.20.7 — Fetch Bridge Seguro

Esta correção substitui o acesso direto navegador → Worker por um proxy
same-origin do próprio app. Assim, Workers antigos não derrubam o boot com um
erro opaco de CORS (`Failed to fetch`), e o servidor retorna o status real.

O boot agora é estritamente de leitura. Abrir, recarregar ou atualizar a
interface não executa Factory Zero e não apaga assets, projetos ou histórico.
Migrações e manutenção permanecem ações explícitas.

Veja `RELEASE_0_20_7_FETCH_BRIDGE_SAFE_BOOT.md`.

# Histórico: Corvo Library V2 0.20.6 — Legacy Core Compatible

O boot não depende de atualizar o Worker. A UI fica vazia, aplica a migration 9014 pelo endpoint de migrations já presente no Core 0.19+, lê o D1 final e só então renderiza.

Veja `RELEASE_0_20_6_LEGACY_CORE_COMPAT.md`.

# Corvo Library V2 — Checkpoint 0.20.6

## Estado real, uma única resposta

Este checkpoint remove a arquitetura de boot em duas fases. A Library não carrega health/stats/projetos antigos e depois substitui o conteúdo por uma segunda resposta.

Quando existe uma conexão salva com o Core:

1. a interface fica em **Carregando dados reais** e não renderiza KPIs, assets ou projetos;
2. o navegador envia apenas `POST /bootstrap`;
3. o Worker, dentro da mesma requisição, verifica/executa o Factory Zero one-shot da release quando necessário;
4. somente depois consulta D1 para stats, universos, catálogo, projetos e operações;
5. a resposta única é aplicada à interface de uma vez.

Não há seed, mock, snapshot intermediário, `PROJ-RECOVER-*` de demonstração ou fallback visual. Se o Core falhar, a UI fica sem dados e mostra o erro; ela não inventa conteúdo.

## Factory Zero one-shot

A release usa o marcador `factory_zero_release_0_20_5`.

No primeiro boot desta release, se o marcador ainda não estiver `DONE`, o Worker limpa o conteúdo operacional e retorna o snapshot já depois da limpeza. O D1 e o bucket R2 continuam sendo os mesmos; bindings/perfil de infraestrutura são preservados.

Depois que o reset desta release termina, reloads normais **não exigem mais contagem zero**. Assets e projetos que o usuário criar/importar depois são preservados e retornados normalmente pelo `/bootstrap`.

## Sem auto-update durante o boot

O boot não publica o próprio Worker, não aplica uma cadeia de health → update → health → reset → refresh e não depende da queda/reconexão do endpoint para montar a tela.

Se o frontend 0.20.6 encontrar um Core antigo que ainda não possui `/bootstrap`, ele mostra `CORE_BOOTSTRAP_UNAVAILABLE`. A atualização do Core é uma ação explícita; somente depois o boot autoritativo é repetido.

## R2 e importação

O bucket configurado permanece o mesmo. O Factory Zero agenda limpeza somente dos prefixes gerenciados pela Corvo quando a release realmente executa o reset. Depois disso, a carga real segue pelo fluxo ZIP → R2 → SHA-256 → D1 → catálogo → reconciliação.

## MCP

O botão `↗ MCP` permanece no topo da aplicação, com o endpoint público pronto para o ChatGPT e autenticação `Nenhuma`.

## Gates

- Checkpoint: 0.20.6;
- Schema: 2.13.0;
- boot: single authoritative response;
- seed/mock visual: proibido;
- TypeScript frontend: PASS;
- TypeScript Worker: PASS;
- MCP: 244 tools preservadas;
- Factory Zero: one-shot por release.
