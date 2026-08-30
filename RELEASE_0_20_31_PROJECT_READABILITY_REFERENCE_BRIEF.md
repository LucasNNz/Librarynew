# Corvo Library V2 0.20.31 — Project Readability + Collector Reference Brief

## Objetivo
Melhorar a legibilidade operacional da tela de Projetos e transformar **Referências** em um slot textual explícito, imediatamente utilizável pelo agente de referências e pelo MCP para orientar o Coletor.

## Projetos — legibilidade
- tipografia operacional ampliada na lista, cabeçalho, KPIs, pipeline, slots, artefatos, resumo e sinais;
- rail lateral de projetos ampliado;
- grid de slots deixa de comprimir 7 cards em uma única linha;
- desktop amplo: até **4 slots por linha**;
- largura intermediária: **3 slots por linha**;
- telas menores: **2 slots por linha**;
- mobile: **1 slot por linha**;
- cards de slot usam fluxo flexível para impedir que ações/rodapés se sobreponham ao conteúdo.

## Novo slot — Referências do Coletor
A ordem operacional passa a iniciar por:

1. Roteiro
2. **Referências do Coletor**
3. Thumbs
4. Títulos
5. Coleta / candidatas
6. Imagens aprovadas
7. ZIP final

O slot **Referências do Coletor** armazena um TXT do agente de referências com o que o Coletor deve buscar.

### Estado e acesso
- aberto para MCP por padrão quando ainda não existe configuração explícita do slot;
- uma configuração explícita de fechamento continua sendo respeitada;
- o TXT é persistido em `automatic_project_files` com role canônica `REFERENCES`;
- aliases históricos de leitura continuam aceitos: `REFERENCIAS`, `REFERENCE_BRIEF`, `IMAGENS_NECESSARIAS` e `IMAGENS NECESSARIAS`;
- anexar o TXT incrementa `state_version` no mesmo fluxo, tornando a alteração perceptível no hot path incremental;
- o snapshot operacional passa a expor também `attachments.references`;
- ao anexar o brief, `REFERENCE_CHECKED` é ativado e `REFERENCE_ANALYSIS_WORKING` é encerrado.

## MCP
Novas ferramentas diretas:

- `anexar_referencias_projeto`
  - recebe conteúdo textual inline;
  - não exige ticket/PUT externo;
  - idempotente pelo hash do conteúdo;
  - retorna preview/download e conteúdo.
- `obter_referencias_projeto`
  - lê o TXT mais recente;
  - retorna conteúdo copiável e links temporários.

Também foi ampliado:
- `preencher_slot_texto_projeto` aceita `reference` além de `script` e `titles`;
- `obter_slots_abertos_projeto` enxerga o slot `reference` como aberto por padrão;
- `obter_slot_projeto` mostra o novo slot imediatamente após Roteiro.

## Interface do slot
Quando há TXT de referências, o próprio card oferece:
- **Ver**;
- **Copiar**;
- **Baixar**.

Roteiro preserva as mesmas ações quando seu artefato está disponível. O inventário geral **Arquivos e artefatos** permanece disponível para todos os demais arquivos do processo.

## Compatibilidade
- App/Core/MCP: **0.20.31**;
- schema D1 permanece **2.20.0**;
- nenhuma migration destrutiva adicionada;
- Worker + D1 + R2 + Queue preservados;
- funcionalidades 0.20.30 de artefatos, SCRIPT auto-parse, self-healing, Collector refinements e FAST READ preservadas.
