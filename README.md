# Corvo Library V2 0.20.26 — Projects Visual Studio

## 0.20.26 — Projects Visual Studio

Atualização visual da aba **Projetos** sobre o Core 0.20.25. Nenhuma migration nova e nenhuma alteração de contrato do Data Plane.

### Interface de Projetos

- composição visual inspirada no painel operacional de referência;
- KPIs de projetos totais, em execução, em análise, concluídos e rejeitados;
- busca por nome, ID, domínio e status;
- lista compacta à esquerda com progresso, lifecycle e agente ativo;
- detalhe amplo do projeto selecionado;
- pipeline visual: Roteiro → Referência → Coletor → Analista visual → Baixador;
- slots integrados visíveis em cards: roteiro, thumbs, títulos, referências, candidatas, aprovadas e ZIP;
- painel de agentes atuando com owner, execution ID, heartbeat e lease;
- resumo real do projeto usando contadores do slot/D1;
- sinais recentes derivados de tags e slots reais;
- lifecycle lock e reabertura explícita preservados;
- seleção em massa, concluir, rejeitar e excluir permanentemente preservados.

### Compatibilidade

- Core esperado: **0.20.25**;
- schema: **2.19.0**;
- Worker embutido: **0.20.25**, sem necessidade de republicação apenas por esta atualização visual;
- nenhuma migration nova;
- nenhum dado D1/R2 alterado pela atualização.

Consulte também `RELEASE_0_20_25_PROJECT_SLOTS_PARALLEL_AGENTS.md` para a camada operacional de slots/estados.
