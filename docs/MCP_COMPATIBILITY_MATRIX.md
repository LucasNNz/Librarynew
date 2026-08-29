# Compatibilidade MCP — Corvo Library V2

Fonte de referência: catálogo MCP da V61.9. A V2 preserva nomes de ferramentas sempre que a semântica continua válida, mas a implementação interna usa D1 + R2 + Queue/Worker.

## Progresso

- Ferramentas históricas: **229**
- Implementadas na V2: **227**
- Substituídas por arquitetura mais segura: **2**
- Planejadas: **0**

> Regra: `IMPLEMENTADO` significa que existe um registro MCP V2 com o mesmo nome. Equivalência comportamental completa ainda será validada por testes de contrato por fase.

| # | Ferramenta | Área | Estado | Observação |
|---:|---|---|---|---|
| 1 | `obter_contexto_biblioteca` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 2 | `buscar_assets` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 3 | `obter_asset` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 4 | `obter_historico_asset` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 5 | `listar_pendentes` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 6 | `obter_pendentes_para_qa_catalogo` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 7 | `catalogar_asset` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 8 | `editar_metadados` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 9 | `registrar_uso` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 10 | `registrar_uso_lote` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 11 | `marcar_rejeitado` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 12 | `restaurar_asset` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 13 | `excluir_asset_permanentemente` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 14 | `aprovar_pendentes_em_lote` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 15 | `excluir_pendentes_permanentemente_em_lote` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 16 | `listar_solicitacoes` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 17 | `criar_solicitacao` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 18 | `atualizar_solicitacao` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 19 | `listar_lotes` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 20 | `criar_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 21 | `obter_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 22 | `adicionar_assets_ao_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 23 | `remover_assets_do_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 24 | `atualizar_status_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 25 | `gerar_manifesto_lote` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 26 | `listar_importacoes` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 27 | `importar_zip_arquivo` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 28 | `importar_midia_arquivo` | Solicitações / lotes / importações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 29 | `listar_destinos_fast_push_projeto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 30 | `obter_modo_entrega_chat` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 31 | `configurar_modo_entrega_chat` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 32 | `fast_visual_packet` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 33 | `obter_candidatas_qa_links` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 34 | `obter_work_packet_lite` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 35 | `obter_resumo_operacional_curto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 36 | `exportar_pacote_qa_json` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 37 | `gerar_grid_candidatas` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 38 | `fast_decidir_candidatas_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 39 | `aprovar_itens_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 40 | `aprovar_target_files_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 41 | `relink_itens_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 42 | `fast_push_urls_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 43 | `importar_candidatas_url_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 44 | `importar_candidata_arquivo_fast_push` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 45 | `vincular_candidatas_fast_push_ao_projeto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 46 | `listar_inbox_candidatas` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 47 | `aprovar_candidatas_fast_push_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 48 | `rejeitar_candidatas_fast_push_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 49 | `decidir_candidatas_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 50 | `aprovar_candidatas_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 51 | `rejeitar_candidatas_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 52 | `rejeitar_itens_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 53 | `excluir_candidatas_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 54 | `fast_push_thumbs_url_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 55 | `fast_push_generated_media` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 56 | `importar_midia_por_url` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 57 | `preparar_upload_midia` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 58 | `confirmar_upload_midia` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 59 | `obter_thumbs_links` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 60 | `fast_decidir_thumbs_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 61 | `fast_push_titulos` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 62 | `listar_pacote_producao_projeto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 63 | `decidir_thumbs_projeto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 64 | `decidir_titulos_projeto` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 65 | `exportar_projeto_completo_zip` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 66 | `gerar_pacote_final` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 67 | `listar_pacotes_prontos_para_download` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 68 | `obter_link_download_pacote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 69 | `confirmar_download_pacote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 70 | `processar_importacao_zip` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 71 | `preparar_upload_zip` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 72 | `importar_zip_por_url` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 73 | `sincronizar_r2` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 74 | `obter_link_download` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 75 | `obter_links_download_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 76 | `exportar_assets_zip` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 77 | `materializar_url` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 78 | `materializar_lote` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 79 | `criar_fila_materializacao_continua` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 80 | `adicionar_itens_fila_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 81 | `obter_status_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 82 | `obter_status_lote_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 83 | `obter_assets_para_qa_lote` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 84 | `registrar_qa_lote` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 85 | `retry_item_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 86 | `adicionar_candidatas_item` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 87 | `aplicar_correcao_tecnica` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 88 | `exportar_zip_arquivo` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 89 | `obter_log_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 90 | `cancelar_lote_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 91 | `obter_host_health` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 92 | `probar_url_controlada` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 93 | `limpar_temporarios_lote` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 94 | `obter_estatisticas_materializacao` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 95 | `procurar_duplicata_hash` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 96 | `resolver_url` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 97 | `testar_url` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 98 | `listar_adapters` | Materialização | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 99 | `obter_painel_estoque` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 100 | `exportar_txt_estoque_giro` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 101 | `configurar_politica_estoque` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 102 | `registrar_consulta_asset` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 103 | `avaliar_necessidade_coleta` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 104 | `obter_ranking_hosts` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 105 | `obter_telemetria_pipeline` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 106 | `obter_status_supervisor_ia` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 107 | `configurar_supervisor_mcp` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 108 | `assumir_proximo_trabalho_supervisor` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 109 | `backfill_projetos_legados` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 110 | `executar_watchdog_supervisor` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 111 | `obter_telemetria_leases_supervisor` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 112 | `assumir_proximo_trabalho` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 113 | `concluir_trabalho_worker` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 114 | `registrar_falha_worker` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 115 | `executar_watchdog_workers` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 116 | `executar_dispatcher_workers` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 117 | `obter_saude_dispatcher` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 118 | `obter_painel_operacional_producao` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 119 | `obter_dashboard_gerencial` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 120 | `configurar_limite_workers` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 121 | `configurar_dominio_projeto` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 122 | `sincronizar_filas_workers` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 123 | `exportar_txt_operacao` | Workers / dispatcher | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 124 | `obter_estado_supervisor` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 125 | `obter_painel_supervisor` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 126 | `obter_candidatas_qa_visual` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 127 | `listar_decisoes_supervisor` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 128 | `resolver_decisao_supervisor` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 129 | `continuar_processamento` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 130 | `pausar_processamento` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 131 | `cancelar_processamento` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 132 | `pausar_item` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 133 | `retomar_item` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 134 | `cancelar_item` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 135 | `aprovar_candidata` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 136 | `rejeitar_candidata` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 137 | `relinkar_item` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 138 | `relinkar_itens_lote` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 139 | `alterar_referencia` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 140 | `alterar_query` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 141 | `trocar_fonte` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 142 | `bloquear_host` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 143 | `desbloquear_host` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 144 | `alterar_timeout` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 145 | `alterar_configuracao_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 146 | `alterar_prioridade_fonte` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 147 | `atualizar_fonte_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 148 | `alterar_limites_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 149 | `materializar_candidata` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 150 | `descartar_candidata` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 151 | `salvar_perfil_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 152 | `atualizar_perfil_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 153 | `listar_perfis_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 154 | `ativar_perfil_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 155 | `desativar_perfil_coleta` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 156 | `salvar_como_padrao` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 157 | `obter_resumo_noturno` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 158 | `congelar_item` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 159 | `registrar_uso_asset` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 160 | `gerar_zip` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 161 | `validar_consistencia` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 162 | `listar_projetos_automaticos` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 163 | `criar_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 164 | `obter_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 165 | `obter_detalhes_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 166 | `obter_snapshot_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 167 | `obter_workspace_politicas` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 168 | `detectar_gap_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 169 | `listar_gaps_operacionais` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 170 | `obter_gap_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 171 | `criar_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 172 | `editar_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 173 | `testar_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 174 | `ativar_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 175 | `promover_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 176 | `suspender_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 177 | `rollback_politica_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 178 | `listar_politicas_operacionais` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 179 | `obter_politicas_aplicadas` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 180 | `vincular_gap_politica` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 181 | `obter_telemetria_politicas` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 182 | `resolver_gap_e_aprender` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 183 | `supervisor_exchange` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 184 | `executar_ate_divergencia` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 185 | `obter_work_packet` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 186 | `obter_status_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 187 | `obter_detalhes_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 188 | `obter_excecoes_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 189 | `executar_tick_planos` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 190 | `pausar_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 191 | `retomar_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 192 | `cancelar_plano` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 193 | `obter_plano_roteamento_fonte` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 194 | `configurar_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 195 | `anexar_arquivo_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 196 | `obter_conteudo_arquivo_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 197 | `baixar_arquivo_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 198 | `processar_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 199 | `reconciliar_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 200 | `validar_consistencia_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 201 | `registrar_qa_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 202 | `regenerar_zip_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 203 | `reabrir_projeto_concluido` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 204 | `verificar_disponibilidade_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 205 | `obter_log_projeto` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 206 | `configurar_fontes_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 207 | `listar_fontes_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 208 | `criar_lote_coleta_automatica` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 209 | `executar_coleta_automatica` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 210 | `obter_status_coleta_automatica` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 211 | `listar_lotes_coleta_automatica` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 212 | `controlar_lote_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 213 | `listar_para_analise_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 214 | `gerar_relatorio_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 215 | `obter_log_detalhado_coleta` | Coleta automática | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 216 | `listar_configuracoes` | Configurações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 217 | `atualizar_configuracao` | Configurações | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 218 | `obter_configuracao_cloudflare` | Configurações | 🔁 SUBSTITUÍDO | Substituído por diagnóstico de bindings; nenhuma credencial R2 fica no D1. |
| 219 | `configurar_cloudflare` | Configurações | 🔁 SUBSTITUÍDO | Substituído por bindings Cloudflare gerenciados fora do app. |
| 220 | `FAST_APPROVE_PROJECT_ITEMS` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 221 | `aplicar_decisoes_supervisor_lote` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 222 | `materializar_urls_lote` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 223 | `obter_resultado_operacao` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 224 | `obter_ultima_operacao` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 225 | `obter_performance_mcp` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 226 | `obter_ranking_rotas_fontes` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 227 | `obter_politica_risco_mcp` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 228 | `obter_log_mcp` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 229 | `verificar_saude` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
