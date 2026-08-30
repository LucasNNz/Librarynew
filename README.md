# Corvo Library V2 — Checkpoint 0.20.5

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

Se o frontend 0.20.5 encontrar um Core antigo que ainda não possui `/bootstrap`, ele mostra `CORE_BOOTSTRAP_UNAVAILABLE`. A atualização do Core é uma ação explícita; somente depois o boot autoritativo é repetido.

## R2 e importação

O bucket configurado permanece o mesmo. O Factory Zero agenda limpeza somente dos prefixes gerenciados pela Corvo quando a release realmente executa o reset. Depois disso, a carga real segue pelo fluxo ZIP → R2 → SHA-256 → D1 → catálogo → reconciliação.

## MCP

O botão `↗ MCP` permanece no topo da aplicação, com endpoint pronto, chave, copiar e `Revogar e gerar nova`.

## Gates

- Checkpoint: 0.20.5;
- Schema: 2.13.0;
- boot: single authoritative response;
- seed/mock visual: proibido;
- TypeScript frontend: PASS;
- TypeScript Worker: PASS;
- MCP: 244 tools preservadas;
- Factory Zero: one-shot por release.
