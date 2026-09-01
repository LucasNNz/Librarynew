# Corvo Library V2 0.20.51 — Inline MCP QA Previews

## Objetivo

Eliminar completamente a dependência do QA visual em abrir URLs externas do Worker dentro do ChatGPT.

A partir desta release, `obter_production_slots_para_qa` entrega os próprios pixels como `ImageContent` do protocolo MCP, lendo os objetos diretamente do binding R2 `MEDIA`.

## Fluxo novo

`PRODUCTION_SLOT ASSIGNED_FOR_QA`
→ MCP consulta D1
→ MCP lê `asset_r2_key` ou `candidate_r2_key` diretamente no R2
→ bytes são codificados em base64 pelo Worker
→ tool result inclui `type: image`
→ ChatGPT vê a imagem na própria resposta da ferramenta
→ QA rejeita somente não conformes
→ `finalizar_qa_projeto`

Não existe etapa de navegador, abertura de domínio, clique, confirmação ou autorização do usuário.

## Regra de não-permissão

Para QA de PSLOT:

- `browser_required = false`;
- `permission_required = false`;
- o agente não deve pedir permissão para acessar `workers.dev` ou qualquer outro domínio;
- `preview_url` não é mais apresentado como caminho operacional principal;
- a URL assinada é mantida apenas em `diagnostic_preview_url` para diagnóstico técnico.

## Paginação

Como imagens inline aumentam o payload MCP, a leitura visual passa a ser paginada:

- padrão: 6 imagens por chamada;
- máximo: 12;
- `offset` permite continuar o mesmo lote;
- `next_offset` e `has_more` são retornados no envelope textual.

Isso permite ao QA percorrer dezenas de PSLOTs automaticamente sem depender de interação humana.

## Limites de segurança de payload

- máximo por imagem inline: 12 MiB;
- máximo agregado por chamada: 36 MiB;
- se um objeto exceder o limite, a resposta orienta continuar por página/rota interna, nunca pedir autorização de navegador.

## Compatibilidade

Preservado integralmente:

- QA por rejeição;
- rejeição atômica de PSLOT;
- fechamento pós-QA;
- upload local de thumb;
- hotfix de cardinalidade THUMB;
- GET + HEAD das rotas assinadas;
- thumb/título opcionais para conclusão;
- separação visual de projetos;
- schema D1 2.26.0, sem migration nova.
