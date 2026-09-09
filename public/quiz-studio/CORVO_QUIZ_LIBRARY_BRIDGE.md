# CORVO QUIZ STUDIO — CONTRATO DE INTEGRAÇÃO COM CORVO LIBRARY

Versão: `corvo-library-quiz/v1`

## Princípio

O Quiz Studio **não cria** Cloudflare, API key ou MCP próprios.
Ele herda a conexão já estabelecida pela Corvo Library/Core.

- Site/Library = interface humana e host.
- MCP da Library = interface operacional da IA.
- Quiz Studio = módulo visual controlável pelo MCP compartilhado.
- Assets continuam sendo os mesmos assets da Library (`asset_id`).
- Imagens não precisam ser anexadas/materializadas no chat.
- A IA recebe URLs públicas/temporárias de preview e debug quando precisa enxergar o resultado.

## Bridge no navegador

O editor expõe:

```js
window.CorvoQuizStudio
```

Métodos principais:

```js
CorvoQuizStudio.handle(command)
CorvoQuizStudio.getState()
CorvoQuizStudio.getProject(full)
CorvoQuizStudio.getSummary()
CorvoQuizStudio.getVisual()
CorvoQuizStudio.detectLibrary()
CorvoQuizStudio.resolveAsset(assetId)
```

### Integração direta preferida

A Library pode expor no `window` ou no `window.parent`:

```js
window.CorvoLibrary = {
  getConnection({ safe, module }),
  quizRequest(op, payload, meta),
  registerQuizStudio(api)
}
```

Também são aceitos como fallback:

```js
CorvoLibrary.request({ scope: 'quiz-studio', op, payload, studio_id, version })
CorvoLibrary.quiz.request(op, payload, meta)
CorvoLibrary.quiz.register(api)
```

Nenhuma dessas funções deve entregar a API key secreta ao editor. O host executa as chamadas server-side usando a conexão já existente.

## Fallback via postMessage

Editor → Library:

```json
{
  "source": "corvo-quiz-studio",
  "version": "corvo-library-quiz/v1",
  "studio_id": "quiz_...",
  "type": "hello"
}
```

Library → Editor:

```json
{
  "source": "corvo-library",
  "type": "hello-ack",
  "connection": {
    "mcp_url": "https://.../mcp",
    "core_url": "https://...",
    "connection_label": "Corvo Library",
    "push": true
  }
}
```

Para requests assíncronos, o editor envia `type: request` + `request_id`; a Library responde `type: response` com o mesmo `request_id`.

## Operações que o host deve atender

### `asset.resolve`

Entrada:

```json
{
  "asset_id": "ASSET-123",
  "purpose": "option-a"
}
```

Saída mínima:

```json
{
  "asset_id": "ASSET-123",
  "url": "https://url-publica-ou-assinada/...",
  "label": "BAKUGO"
}
```

A URL deve ser acessível pelo navegador sem expor credenciais Cloudflare.

### `quiz.state.push`

O Studio envia estado compacto após mudanças locais/remotas:

```json
{
  "revision": 42,
  "active_scene": 12,
  "project": { "...": "estado compacto" }
}
```

A Library/Core persiste ou distribui esse estado para a sessão atual.

### `quiz.visual.publish`

Entrada:

```json
{
  "studio_id": "quiz_...",
  "revision": 42,
  "scene": 12,
  "state": { "...": "estado compacto" }
}
```

Saída:

```json
{
  "preview_url": "https://.../quiz/preview/...",
  "debug_url": "https://.../quiz/debug/..."
}
```

- `preview_url`: somente o frame final.
- `debug_url`: frame com zonas/eixos/scaffold para inspeção geométrica.
- As URLs devem ser acessíveis ao ChatGPT diretamente, sem materialização de arquivo na conversa.

## Push Library → Editor

```json
{
  "source": "corvo-library",
  "type": "quiz.command",
  "command_id": "CMD-123",
  "request": {
    "op": "apply_batch",
    "operations": []
  }
}
```

Resposta:

```json
{
  "source": "corvo-quiz-studio",
  "type": "quiz.ack",
  "command_id": "CMD-123",
  "result": {
    "ok": true,
    "updated": 30,
    "revision": 43,
    "active_scene": 12,
    "total_scenes": 100
  }
}
```

## Comandos do Studio

### `get_state`
Resposta curta da cena ativa + revisão + visual quando disponível.

### `get_project`
Use `full: false` por padrão. `full: true` apenas para diagnóstico/backup.

### `get_scene`
Obtém uma cena específica.

### `apply`
Patch de uma cena.

Exemplo:

```json
{
  "op": "apply",
  "scene": 12,
  "patch": {
    "title": "QUAL VOCÊ ESCOLHERIA?",
    "sceneNumber": "12",
    "format": "16:9",
    "skin": "white",
    "motion": "zoom-alternado",
    "a": {
      "asset_id": "ASSET-BAKUGO",
      "label": "BAKUGO",
      "size": 108,
      "color": "#66c9ff"
    },
    "b": {
      "asset_id": "ASSET-TODOROKI",
      "label": "TODOROKI",
      "size": 105,
      "color": "#ff7855"
    },
    "layout": {
      "options": {
        "a": { "x": 20, "y": 27, "w": 24, "h": 46 },
        "b": { "x": 58, "y": 27, "w": 24, "h": 46 }
      }
    }
  }
}
```

Se só vier `asset_id`, o Studio pede `asset.resolve` à Library. Para máxima velocidade, o Core pode enviar `asset_id + image_url` no mesmo push.

### `apply_batch`
Formato preferido para produção em lote. Até 200 operações por chamada no contrato atual.

```json
{
  "op": "apply_batch",
  "operations": [
    { "op": "set_scene", "scene": 1, "patch": { "title": "..." } },
    { "op": "set_scene", "scene": 2, "patch": { "a": { "asset_id": "ASSET-2" } } }
  ]
}
```

Resposta deve continuar curta: `ok`, `updated`, `revision`, `active_scene`, `total_scenes`.

### Outros

- `set_active_scene`
- `add_scene`
- `duplicate_scene`
- `delete_scene`
- `move_scene`
- `get_visual`
- `export_scene`

## Ferramentas a acrescentar ao MCP da Library

Recomendação de superfície enxuta:

1. `quiz_obter_estado`
2. `quiz_alterar`
3. `quiz_alterar_lote`
4. `quiz_definir_cena_ativa`
5. `quiz_ver`
6. `quiz_exportar_cena`

As ferramentas de busca de imagens permanecem as ferramentas já existentes da Library. O fluxo ideal é:

`buscar asset → obter asset_id → quiz_alterar/quiz_alterar_lote`

Não criar ferramentas duplicadas de busca dentro do Quiz Studio.

## Exemplo de fluxo IA

1. ChatGPT usa Library MCP para buscar Bakugo/Todoroki.
2. Recebe `asset_id` dos dois.
3. Chama `quiz_alterar` ou `quiz_alterar_lote`.
4. Core envia push ao editor aberto.
5. Editor aplica sem confirmação local e incrementa `revision`.
6. Core publica `preview_url` e `debug_url`.
7. ChatGPT abre a URL para conferir visualmente.
8. Se necessário, envia novo patch apenas com as diferenças.

## Segurança / credenciais

- O Quiz Studio não recebe nem armazena a API key da Library.
- A conexão Cloudflare continua sob responsabilidade da camada server-side da Library/Core.
- URLs de assets/preview podem ser públicas temporárias, assinadas ou capability URLs.
- Nunca colocar Secret/API key em URL de asset, `postMessage`, projeto JSON ou estado do Quiz.


## Exportador V2.1

O projeto salvo pelo editor usa `version: 4` e preserva recursos de exportação avançados.

Campos relevantes por cena:

- `transitionType`: `cut | crossfade | slide-left | flash | zoom-fade`
- `transitionDuration`: duração da transição em segundos
- `backgroundVideo`: Data URL opcional de MP4/WebM
- `backgroundVideoUrl`: URL opcional de MP4/WebM

Áudio do projeto:

```json
{
  "audio": {
    "data": "data:audio/...",
    "name": "trilha.mp3",
    "volume": 1,
    "loop": true
  }
}
```

Para exportação de projeto com cenas 16:9 e 9:16 misturadas, o editor permite selecionar apenas um dos formatos por MP4. O Core não precisa separar o projeto antes de editar.
