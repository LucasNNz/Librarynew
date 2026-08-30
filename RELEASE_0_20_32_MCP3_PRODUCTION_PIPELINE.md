# RELEASE 0.20.32 — MCP3 Production Pipeline

## Objetivo
Fechar a ponte entre referências aprovadas e a produção final do projeto sem confundir pools semânticos com cenas/arquivos finais.

## Mudanças principais
- Novo modelo persistente: `v2_reference_pools`, `v2_production_scenes`, `v2_production_slots`.
- Schema D1 atualizado para **2.21.0** com migration `9021_v2_production_model.sql`.
- SCRIPT passa a materializar/reconciliar o modelo de produção idempotentemente.
- `target_file` é chave operacional real do slot; reprocessar o mesmo roteiro não duplica cenas/slots.
- `assign_assets_to_slots` aceita até 500 vínculos e permite um AST em N slots sem copiar bytes no R2.
- `criar_slots_projeto_lote` permite upsert de slots por `target_file`.
- FAST APPROVE por `target_file` consegue criar/vincular o production slot quando necessário.
- ZIP final usa o manifesto de production slots; o mesmo AST pode aparecer várias vezes no ZIP com nomes finais diferentes.
- O gate de conclusão global depende dos production slots resolvidos (e pacote quando obrigatório), não dos reference pools.
- QA padrão aceita até 100 decisões, devolve ACK 202 e processa internamente em chunks de 10 na Queue.
- A rota síncrona permanece separada como `submit_qa_decisions_sync` para diagnóstico/compatibilidade.
- Snapshot operacional e UI mostram contagens separadas de pools, cenas e slots.

## Compatibilidade
- FAST READ, legibilidade de Projetos, slot Referências do Coletor, Project Artifacts e fluxo de coleta anterior foram preservados.
- Rotas históricas de pacote permanecem aceitas internamente, mas as ferramentas MCP de projeto solicitam `PROJECT_PRODUCTION_ZIP`.
- Se ainda não existir modelo de production slots em um projeto legado, o exportador preserva fallback histórico; quando slots existem, eles viram a fonte de verdade.

## Regra central
`ASSET 1:N PRODUCTION_SLOTS`. O R2 armazena o objeto uma vez; o manifesto define quantas entradas/nomeações aparecem no pacote final.
