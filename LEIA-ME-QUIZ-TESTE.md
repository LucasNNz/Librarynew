# Librarynew 0.20.59 — Quiz Teste integrado

O Quiz Teste está incluído no Librarynew, com entrada no menu, editor manual original e comandos no **mesmo endpoint /mcp**. Não foi criado outro MCP.

## Ativação

1. Publique este projeto no lugar da versão anterior do Librarynew, pelo processo de publicação que você já utiliza. Execute `npm ci` e `npm run build` para gerar a aplicação.
2. Atualize também o Core pelo fluxo existente de Configurações. O bundle embarcado já contém os novos comandos. App e Core devem mostrar **0.20.59**. As tabelas do Quiz são adicionais; a migração `cloudflare/migrations/9028_quiz_studio.sql` não apaga tabelas da Library e também é aplicada de forma idempotente no primeiro acesso ao módulo.
3. Para operação automática com o navegador do usuário fechado, mantenha o executor incluído rodando em um servidor com Docker. Na pasta `quiz-executor`, configure `CORVO_CORE_URL` e `CORVO_APP_KEY` com a conexão já existente da Library e execute:

   ```bash
   docker compose up -d --build
   ```

   Essas configurações pertencem ao servidor. Não devem ser enviadas ao GPT, colocadas em prompts ou gravadas no projeto de quiz. O executor não publica outra porta/MCP; ele consulta o Core existente.
4. Abra **Quiz Teste** no menu da Library para criar/editar manualmente. Atualize a lista de ferramentas da conexão MCP existente no GPT. `quiz_comandos` informa se o executor está online.

**O executor é necessário para executar comandos do editor, gerar previews e exportar automaticamente.** O Worker Cloudflare existente não executa Canvas/WebCodecs. Sem o executor, consultas ao estado salvo e edição manual continuam disponíveis, mas comandos automáticos permanecem na fila. Não é necessário deixar o editor aberto no computador pessoal quando o executor está ativo.

Esta entrega é código testado localmente; não foi publicada na sua infraestrutura.

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
| `quiz_ver` | Gerar PNG real e PNG de debug com coordenadas |
| `quiz_operacao` | Consultar resultado, erro e links; `inline_preview:true` devolve PNG no MCP |
| `quiz_cancelar` | Cancelar fila/exportação |

## Fluxo recomendado para o GPT

1. Consulte `quiz_comandos` e `quiz_listar`.
2. Crie um quiz com `quiz_criar` usando um `id` estável.
3. Descubra os campos reais com `quiz_executar`, `op:"get_schema"`. O resultado inclui schema, exemplo completo de cena, controles editáveis e áudio.
4. Consulte a operação até `SUCCEEDED`, `FAILED` ou `CANCELLED`.
5. Busque imagens com as ferramentas já existentes da Library. Envie somente `asset_id` nos patches.
6. Prefira `quiz_alterar_lote` para várias cenas. Reutilize exatamente o mesmo `request_id` ao repetir uma solicitação após falha de rede.
7. Consulte `quiz_ver` e depois `quiz_operacao` com `inline_preview:true` para inspecionar o PNG na própria resposta MCP.
8. Exporte com `export_scene_mp4` ou `export_project_mp4`. O resultado contém um link direto para o MP4 salvo pelo Core.

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
- O executor usa lease com heartbeat. Se cair, a operação é marcada como falha, em vez de ser repetida silenciosamente.
- Snapshot e conclusão da operação são confirmados na mesma transação D1.
- Imagens/áudio manuais são enviados pelo host diretamente ao armazenamento. MP4s são enviados em partes de até 8 MiB, sem atravessar o chat.
- Links de mídia são URLs de capacidade com identificador aleatório, sem API key. Quem possuir o link poderá abri-lo. As URLs são persistentes enquanto a mídia existir.
- Assets da Library são resolvidos novamente antes de preview/exportação para renovar URLs assinadas expiradas.
- O mesmo renderer Canvas do editor produz o vídeo. O executor inclui FFmpeg para AAC, mantendo volume, repetição e envelope de fades sem depender de AAC disponível no Chromium do servidor.
- Limites atuais: 1.000 cenas, lote de 200 operações, comando de aproximadamente 2 MB, snapshot de aproximadamente 8 MB e mídia de até 5 GB. Projetos extensos podem exigir mais RAM/disco e tempo de render.

Nenhuma operação desta integração requer materialização de arquivos no chat, nova chave para o Quiz ou confirmação adicionada pelo módulo. **A política de aprovação do próprio cliente GPT continua sendo controlada pelo cliente; o código de um MCP não pode garantir nem desativar essas aprovações.**

## Validação e manutenção

- `npm run validate:structural`: tipos da aplicação e do Core.
- `npm run build`: build de produção e bundle embarcado do Worker.
- `npm run test:quiz`: persistência, idempotência, concorrência, cancelamento, lease e mídia.
- `node tests/quiz-e2e.mjs`: executor real com Chromium, geração PNG/MP4 e AAC verificado por FFprobe. Instale antes as dependências em `quiz-executor` e configure `CHROME_EXECUTABLE` para o Chrome instalado.
- `node tests/quiz-ui.mjs`: tela integrada, salvamento manual e atualização remota; usa o build da aplicação e Chrome.

O script do editor foi preservado em `public/quiz-studio/index.html`. O adaptador adicional está também em `quiz-executor/editor-adapter.js` para revisão; o HTML entregue já contém esse adaptador. Ao alterar o adaptador, execute `node scripts/sync-quiz-adapter.mjs` na raiz antes do build.
