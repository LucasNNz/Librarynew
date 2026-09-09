# Librarynew 0.20.60 — Quiz Teste integrado

O Quiz Teste está incluído no Librarynew, com entrada no menu, editor manual original e comandos no **mesmo endpoint /mcp**. Não foi criado outro MCP.

## Ativação

1. Publique este projeto no lugar da versão anterior e execute `npm ci` e `npm run build`.
2. Em **Configurações**, atualize o Core pelo fluxo já existente. O pacote adiciona automaticamente o binding `BROWSER` do Cloudflare Browser Rendering ao mesmo Worker, conserva D1/R2/fila/chaves e mantém o mesmo endpoint `/mcp`. App e Core devem mostrar **0.20.60**.
3. Atualize as ferramentas da conexão MCP 19 no GPT e execute `quiz_comandos`. O resultado esperado é `renderer_online:true`, `renderer.mode:"CLOUDFLARE_BROWSER_RENDERING"` e `default_quiz_id:"quiz-teste"`.
4. O documento `quiz-teste` é criado idempotentemente com uma cena real e revisão 1 no primeiro acesso. O editor manual abre o mesmo snapshot persistido.

O executor é acionado pela fila do Core e abre uma sessão isolada do Cloudflare Browser Rendering para cada job. O navegador pessoal pode ficar fechado. A sessão recebe somente um lease temporário do job e pode resolver assets e enviar artefatos ao R2; nenhuma chave é entregue ao GPT ou gravada no Quiz.

A pasta `quiz-executor` permanece como alternativa compatível para ambientes que prefiram Docker/FFmpeg. Ela não é necessária quando o binding `BROWSER` está disponível.

## Ferramentas MCP

| Ferramenta | Função |
| --- | --- |
| `quiz_comandos` | Descobrir operações, limites e estado do executor |
| `quiz_listar` | Listar quizzes e revisões |
| `quiz_criar` | Criar quiz; `project_id` permite vínculo com um projeto da Library |
| `quiz_obter_estado` | Consultar estado persistido imediatamente; cena completa ou paginação |
| `quiz_executar` | Executar qualquer operação do editor pela superfície compartilhada |
| `quiz_alterar` | Editar uma cena por patch |
| `quiz_alterar_lote` | Aplicar até 200 edições com rollback integral em caso de erro |
| `quiz_ver` | Gerar PNG real e devolvê-lo inline automaticamente quando terminar no tempo de espera |
| `quiz_gerar_mp4` | Gerar MP4 de uma cena ou do projeto e retornar o job |
| `quiz_operacao` | Consultar `SUCCEEDED`/erro/links; PNG concluído é inline por padrão |
| `quiz_cancelar` | Cancelar fila/exportação |

## Fluxo recomendado para o GPT

1. Consulte `quiz_comandos` e `quiz_listar`.
2. Leia diretamente `quiz-teste`, que já nasce persistido; use `quiz_criar` apenas para outro Quiz.
3. Descubra os campos reais com `quiz_executar`, `op:"get_schema"`. O resultado inclui schema, exemplo completo de cena, controles editáveis e áudio.
4. Consulte a operação até `SUCCEEDED`, `FAILED` ou `CANCELLED`.
5. Busque imagens com as ferramentas já existentes da Library. Envie somente `asset_id` nos patches.
6. Prefira `quiz_alterar_lote` para várias cenas. Reutilize exatamente o mesmo `request_id` ao repetir uma solicitação após falha de rede.
7. Chame `quiz_ver`; ele aguarda até 25 segundos por padrão e já inclui o PNG na resposta quando concluído. Se ainda estiver processando, consulte `quiz_operacao`.
8. Chame `quiz_gerar_mp4` e consulte `quiz_operacao` até `SUCCEEDED`. O resultado contém `download_url` para o MP4 persistido no Core.

`QUEUED` significa recebido, não aplicado. Edições e renders executam fora da requisição MCP, evitando deixar o chat esperando a exportação. O tempo de render depende da duração, efeitos e capacidade do servidor; não é instantâneo.

Exemplo de edição:

```json
{
  "id": "quiz-exemplo",
  "request_id": "cena-1-v1",
  "scene": 1,
  "patch": {
    "title": "QUAL VOCÊ ESCOLHERIA?",
    "format": "16:9",
    "a": {"asset_id": "AST-ID-REAL", "label": "OPÇÃO A"},
    "b": {"asset_id": "AST-OUTRO-ID-REAL", "label": "OPÇÃO B"}
  }
}
```

Use IDs reais retornados pela Library. As cenas são numeradas a partir de 1. Patches mesclam objetos; arrays, como `overlays` e `textBlocks`, são substituídos por inteiro.

## Cobertura das operações

| Área | Operações / parâmetros |
| --- | --- |
| Estado e contrato | `get_schema`, `get_state`, `summary`, `get_project`, `get_scene` |
| Edição completa | `apply`, `set_scene`; todos os campos do exemplo retornado por `get_schema` |
| Lote | `apply_batch`, `set_many`, até 200 operações de cenas |
| Cenas | `add_scene`, `add_text_scene`, `duplicate_scene`, `delete_scene`, `move_scene`, `set_active_scene`, `reset_scene`, `import_scenes` |
| Seleção | `set_selection` com `scenes`; `apply_to_selection` com `patch` e opcionalmente `scenes` |
| Imagens, cards e camadas | Patch de `a`–`d`, `overlays`, `background_asset_id`, `background_video_asset_id`; `clearImage` e `clearBackground` |
| Textos | `sceneType`, `textBlocks` e todos os campos reais de título/tamanho/cor/posição |
| Layout | `apply_placement`, `set_scene_placement`, `auto_layout`, `get_coordinates` |
| Áudio | `set_audio`, `audio.asset_id`, `volume`, `loop`, `fadeIn`, `fadeOut`; `audio:null` remove |
| Transições e fundos | `transitionType`, `transitionDuration`, fundo imagem/vídeo e movimento |
| Controles manuais | `set_control` com `id` e `value` dos controles retornados pelo schema; dispara os mesmos eventos do editor, sem seletores arbitrários, upload dialog ou credenciais |
| Reprodução/interface | `present`, `stop_present`, `set_playback` (`paused`/`restart`), `set_editor_visible` (`visible`) |
| Preview/PNG | `get_visual`, `export_png`, `export_scene`, `export_scene_package`; `scene` e `time` opcionais |
| MP4 | `export_scene_mp4`; `export_project_mp4` com `format:"16:9"` ou `"9:16"` se o projeto mistura formatos |
| Projeto/modelo JSON | `export_project`, `replace_project` com `project` |
| Configuração de camada | `export_overlay_placement` com `scene` e `slot` de 1 a 3 |
| Diagnóstico | `get_diagnostics` e resultado da exportação |

Ações de apresentação/interface realizadas no executor referem-se ao navegador do executor. Para conferir o resultado visual no GPT, use o PNG. O editor manual mantém os comandos próprios de tela cheia, escolha de arquivos, salvar e abrir modelos. Automação usa IDs, JSON e links em vez desses diálogos locais.

## Estado compartilhado e arquivos

- Edições manuais são salvas automaticamente e alterações remotas são atualizadas por revisão.
- Se houver edição simultânea, a versão antiga não sobrescreve a nova. A tela mantém a edição local e oferece salvar uma cópia antes de carregar a versão atual.
- O executor integrado usa um lease por job e a fila existente do Core. Uma sessão não pode acessar outro job.
- Snapshot e conclusão da operação são confirmados na mesma transação D1.
- Imagens/áudio manuais são enviados pelo host diretamente ao armazenamento. MP4s são enviados em partes de até 8 MiB, sem atravessar o chat.
- Links de mídia são URLs de capacidade com identificador aleatório, sem API key. Quem possuir o link poderá abri-lo. As URLs são persistentes enquanto a mídia existir.
- Assets da Library são resolvidos novamente antes de preview/exportação para renovar URLs assinadas expiradas.
- O mesmo renderer Canvas/WebCodecs do editor produz PNG e MP4 no navegador Cloudflare. A alternativa Docker inclui FFmpeg para AAC.
- Limites atuais: 1.000 cenas, lote de 200 operações, comando de aproximadamente 2 MB, snapshot de aproximadamente 8 MB e mídia de até 5 GB. Projetos extensos podem exigir mais RAM/disco e tempo de render.

Nenhuma operação desta integração requer materialização de arquivos no chat, nova chave para o Quiz ou confirmação adicionada pelo módulo. **A política de aprovação do próprio cliente GPT continua sendo controlada pelo cliente; o código de um MCP não pode garantir nem desativar essas aprovações.**

## Validação e manutenção

- `npm run validate:structural`: tipos da aplicação e do Core.
- `npm run build`: build de produção e bundle embarcado do Worker.
- `npm run test:quiz`: persistência, idempotência, concorrência, cancelamento, lease e mídia.
- `node tests/quiz-e2e.mjs`: executor real com Chromium, geração PNG/MP4 e AAC verificado por FFprobe. Instale antes as dependências em `quiz-executor` e configure `CHROME_EXECUTABLE` para o Chrome instalado.
- `node tests/quiz-ui.mjs`: tela integrada, salvamento manual e atualização remota; usa o build da aplicação e Chrome.

O script do editor foi preservado em `public/quiz-studio/index.html`. O adaptador adicional está também em `quiz-executor/editor-adapter.js` para revisão; o HTML entregue já contém esse adaptador. Ao alterar o adaptador, execute `node scripts/sync-quiz-adapter.mjs` na raiz antes do build.
