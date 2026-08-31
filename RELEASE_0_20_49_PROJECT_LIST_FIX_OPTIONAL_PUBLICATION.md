# Corvo Library V2 0.20.49 — Project List Geometry + Optional Publication

## Objetivo
Corrigir a regressão visual introduzida na 0.20.48 na lista lateral de projetos e permitir o fechamento de projetos de produção sem exigir thumb nem título.

## Correção visual
- os cards de projeto dentro de `.projectCardList` agora usam `flex: 0 0 auto` e `min-height: 78px`;
- a lista continua com scroll vertical próprio, mas os cards não são mais comprimidos para caber todos simultaneamente;
- `content-visibility/contain` foi desativado especificamente nos cards da lista para evitar geometria intrínseca incorreta dentro do rail flex;
- scrollbars modernos da 0.20.48 permanecem preservados;
- separação entre Em andamento / Concluídos / Rejeitados permanece preservada.

## Fechamento sem thumb/título
Para projeto com PRODUCTION_SLOT, a conclusão explícita agora exige somente:
1. todos os PRODUCTION_SLOTs finais resolvidos/congelados;
2. `PROJECT_IMAGES_ZIP` pronto (`imagens.zip`);
3. `PROJECT_SCRIPT_TXT` pronto (`roteiro.txt`).

`PROJECT_PUBLICATION_ZIP` (`thumbs_titulos.zip`) é opcional para o lifecycle `COMPLETED`.

A ausência de thumbs ou títulos não impede `concluir_projetos` e não faz `productionCompletionGate.can_complete` retornar falso quando os artefatos obrigatórios estão prontos.

## API/UI
- `obter_arquivos_finais_projeto` passa a expor `required_for_completion` e `optional` em cada artefato;
- `PROJECT_PUBLICATION_ZIP` retorna `optional: true`;
- a interface marca THUMBS + TÍTULOS como opcional e explica que pode ser criado depois;
- o resumo de Thumbs e Títulos também indica `opcional`.

## Compatibilidade
- schema D1 permanece `2.26.0`;
- nenhuma migration nova;
- QA por rejeição, finalização pós-QA, upload local de thumb e hotfix D1 de THUMB permanecem intactos.
