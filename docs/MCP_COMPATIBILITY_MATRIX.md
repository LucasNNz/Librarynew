# Compatibilidade MCP — Corvo Library V2

Fonte de referência: catálogo MCP da V61.9. A V2 preserva nomes de ferramentas sempre que a semântica continua válida, mas a implementação interna usa D1 + R2 + Queue/Worker.

## Progresso

- Ferramentas históricas: **229**
- Implementadas na V2: **40**
- Substituídas por arquitetura mais segura: **2**
- Planejadas: **187**

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
| 13 | `excluir_asset_permanentemente` | Catálogo | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 14 | `aprovar_pendentes_em_lote` | Catálogo | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 15 | `excluir_pendentes_permanentemente_em_lote` | Catálogo | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
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
| 27 | `importar_zip_arquivo` | Solicitações / lotes / importações | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 28 | `importar_midia_arquivo` | Solicitações / lotes / importações | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 29 | `listar_destinos_fast_push_projeto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 30 | `obter_modo_entrega_chat` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 31 | `configurar_modo_entrega_chat` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 32 | `fast_visual_packet` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 33 | `obter_candidatas_qa_links` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 34 | `obter_work_packet_lite` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 35 | `obter_resumo_operacional_curto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 36 | `exportar_pacote_qa_json` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 37 | `gerar_grid_candidatas` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 38 | `fast_decidir_candidatas_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 39 | `aprovar_itens_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 40 | `aprovar_target_files_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 41 | `relink_itens_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 42 | `fast_push_urls_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 43 | `importar_candidatas_url_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 44 | `importar_candidata_arquivo_fast_push` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 45 | `vincular_candidatas_fast_push_ao_projeto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 46 | `listar_inbox_candidatas` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 47 | `aprovar_candidatas_fast_push_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 48 | `rejeitar_candidatas_fast_push_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 49 | `decidir_candidatas_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 50 | `aprovar_candidatas_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 51 | `rejeitar_candidatas_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 52 | `rejeitar_itens_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 53 | `excluir_candidatas_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 54 | `fast_push_thumbs_url_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 55 | `fast_push_generated_media` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 56 | `importar_midia_por_url` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 57 | `preparar_upload_midia` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 58 | `confirmar_upload_midia` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 59 | `obter_thumbs_links` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 60 | `fast_decidir_thumbs_lote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 61 | `fast_push_titulos` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 62 | `listar_pacote_producao_projeto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 63 | `decidir_thumbs_projeto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 64 | `decidir_titulos_projeto` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 65 | `exportar_projeto_completo_zip` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 66 | `gerar_pacote_final` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 67 | `listar_pacotes_prontos_para_download` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 68 | `obter_link_download_pacote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 69 | `confirmar_download_pacote` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 70 | `processar_importacao_zip` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 71 | `preparar_upload_zip` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 72 | `importar_zip_por_url` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 73 | `sincronizar_r2` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 74 | `obter_link_download` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 75 | `obter_links_download_lote` | FAST PUSH / produção / entrega | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 76 | `exportar_assets_zip` | FAST PUSH / produção / entrega | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 77 | `materializar_url` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 78 | `materializar_lote` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 79 | `criar_fila_materializacao_continua` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 80 | `adicionar_itens_fila_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 81 | `obter_status_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 82 | `obter_status_lote_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 83 | `obter_assets_para_qa_lote` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 84 | `registrar_qa_lote` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 85 | `retry_item_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 86 | `adicionar_candidatas_item` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 87 | `aplicar_correcao_tecnica` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 88 | `exportar_zip_arquivo` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 89 | `obter_log_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 90 | `cancelar_lote_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 91 | `obter_host_health` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 92 | `probar_url_controlada` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 93 | `limpar_temporarios_lote` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 94 | `obter_estatisticas_materializacao` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 95 | `procurar_duplicata_hash` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 96 | `resolver_url` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 97 | `testar_url` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 98 | `listar_adapters` | Materialização | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 99 | `obter_painel_estoque` | Estoque / telemetria | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 100 | `exportar_txt_estoque_giro` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 101 | `configurar_politica_estoque` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 102 | `registrar_consulta_asset` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 103 | `avaliar_necessidade_coleta` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 104 | `obter_ranking_hosts` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 105 | `obter_telemetria_pipeline` | Estoque / telemetria | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 106 | `obter_status_supervisor_ia` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 107 | `configurar_supervisor_mcp` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 108 | `assumir_proximo_trabalho_supervisor` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 109 | `backfill_projetos_legados` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 110 | `executar_watchdog_supervisor` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 111 | `obter_telemetria_leases_supervisor` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 112 | `assumir_proximo_trabalho` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 113 | `concluir_trabalho_worker` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 114 | `registrar_falha_worker` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 115 | `executar_watchdog_workers` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 116 | `executar_dispatcher_workers` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 117 | `obter_saude_dispatcher` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 118 | `obter_painel_operacional_producao` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 119 | `obter_dashboard_gerencial` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 120 | `configurar_limite_workers` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 121 | `configurar_dominio_projeto` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 122 | `sincronizar_filas_workers` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 123 | `exportar_txt_operacao` | Workers / dispatcher | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 124 | `obter_estado_supervisor` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 125 | `obter_painel_supervisor` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 126 | `obter_candidatas_qa_visual` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 127 | `listar_decisoes_supervisor` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 128 | `resolver_decisao_supervisor` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 129 | `continuar_processamento` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 130 | `pausar_processamento` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 131 | `cancelar_processamento` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 132 | `pausar_item` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 133 | `retomar_item` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 134 | `cancelar_item` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 135 | `aprovar_candidata` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 136 | `rejeitar_candidata` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 137 | `relinkar_item` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 138 | `relinkar_itens_lote` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 139 | `alterar_referencia` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 140 | `alterar_query` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 141 | `trocar_fonte` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 142 | `bloquear_host` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 143 | `desbloquear_host` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 144 | `alterar_timeout` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 145 | `alterar_configuracao_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 146 | `alterar_prioridade_fonte` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 147 | `atualizar_fonte_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 148 | `alterar_limites_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 149 | `materializar_candidata` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 150 | `descartar_candidata` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 151 | `salvar_perfil_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 152 | `atualizar_perfil_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 153 | `listar_perfis_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 154 | `ativar_perfil_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 155 | `desativar_perfil_coleta` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 156 | `salvar_como_padrao` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 157 | `obter_resumo_noturno` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 158 | `congelar_item` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 159 | `registrar_uso_asset` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 160 | `gerar_zip` | Supervisor / perfis | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 161 | `validar_consistencia` | Supervisor / perfis | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 162 | `listar_projetos_automaticos` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 163 | `criar_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 164 | `obter_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 165 | `obter_detalhes_projeto_automatico` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 166 | `obter_snapshot_operacional` | Projetos automáticos / políticas / planos | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 167 | `obter_workspace_politicas` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 168 | `detectar_gap_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 169 | `listar_gaps_operacionais` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 170 | `obter_gap_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 171 | `criar_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 172 | `editar_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 173 | `testar_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 174 | `ativar_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 175 | `promover_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 176 | `suspender_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 177 | `rollback_politica_operacional` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 178 | `listar_politicas_operacionais` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 179 | `obter_politicas_aplicadas` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 180 | `vincular_gap_politica` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 181 | `obter_telemetria_politicas` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 182 | `resolver_gap_e_aprender` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 183 | `supervisor_exchange` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 184 | `executar_ate_divergencia` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 185 | `obter_work_packet` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 186 | `obter_status_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 187 | `obter_detalhes_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 188 | `obter_excecoes_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 189 | `executar_tick_planos` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 190 | `pausar_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 191 | `retomar_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 192 | `cancelar_plano` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 193 | `obter_plano_roteamento_fonte` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 194 | `configurar_projeto_automatico` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 195 | `anexar_arquivo_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 196 | `obter_conteudo_arquivo_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 197 | `baixar_arquivo_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 198 | `processar_projeto_automatico` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 199 | `reconciliar_projeto_automatico` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 200 | `validar_consistencia_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 201 | `registrar_qa_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 202 | `regenerar_zip_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 203 | `reabrir_projeto_concluido` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 204 | `verificar_disponibilidade_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 205 | `obter_log_projeto` | Projetos automáticos / políticas / planos | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 206 | `configurar_fontes_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 207 | `listar_fontes_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 208 | `criar_lote_coleta_automatica` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 209 | `executar_coleta_automatica` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 210 | `obter_status_coleta_automatica` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 211 | `listar_lotes_coleta_automatica` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 212 | `controlar_lote_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 213 | `listar_para_analise_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 214 | `gerar_relatorio_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 215 | `obter_log_detalhado_coleta` | Coleta automática | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 216 | `listar_configuracoes` | Configurações | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 217 | `atualizar_configuracao` | Configurações | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 218 | `obter_configuracao_cloudflare` | Configurações | 🔁 SUBSTITUÍDO | Substituído por diagnóstico de bindings; nenhuma credencial R2 fica no D1. |
| 219 | `configurar_cloudflare` | Configurações | 🔁 SUBSTITUÍDO | Substituído por bindings Cloudflare gerenciados fora do app. |
| 220 | `FAST_APPROVE_PROJECT_ITEMS` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 221 | `aplicar_decisoes_supervisor_lote` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 222 | `materializar_urls_lote` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 223 | `obter_resultado_operacao` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
| 224 | `obter_ultima_operacao` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 225 | `obter_performance_mcp` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 226 | `obter_ranking_rotas_fontes` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 227 | `obter_politica_risco_mcp` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 228 | `obter_log_mcp` | Operação rápida / diagnóstico | ⬜ PLANEJADO | Será portado sobre os serviços V2, sem copiar a infraestrutura legada. |
| 229 | `verificar_saude` | Operação rápida / diagnóstico | ✅ IMPLEMENTADO | Nome histórico preservado no MCP V2. |
