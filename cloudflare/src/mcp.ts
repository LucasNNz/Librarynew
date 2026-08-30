import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import type { Env } from "./types";
import { catalogStats, getAsset, getAssetLink, getAssetLinks, listAssets, listUniverses } from "./core/assets";
import { approveCandidate, deleteIngestCandidates, enqueueFastPushItems, fastPush, getOperation, linkCandidatesToProject, listCandidates, rejectCandidate } from "./core/ingest";
import { confirmDirectUpload, getDirectUpload, prepareDirectUpload } from "./core/direct-upload";
import { approvePendingAssets, catalogAsset, deleteAssetPermanently, deleteAssetsPermanently, deletePendingAssetsPermanently, findDuplicateR2Keys, getAssetHistory, registerAssetUsage, rejectAsset, restoreAsset, updateAssetMetadata } from "./core/asset-ops";
import { addAssetsToBatch, createBatch, createRequest, generateBatchManifest, getBatch, listBatches, listImports, listRequests, removeAssetsFromBatch, updateBatchStatus, updateRequest } from "./core/work-items";
import { integritySample } from "./core/storage";
import { fullStorageAudit, latestStorageAudit } from "./core/storage-audit";
import { findDuplicateHash, getMaterializationStats, listAdapters, listHostHealth, listIngestEvents, probeRemoteUrl, retryIngestCandidate } from "./core/materialization";
import { latestOperation, listOperations, mcpPerformance, operationalRisk, pipelineTelemetry, sourceRouteRanking } from "./core/operations";
import { claimNextWork, completeWork, configureWorkerLimit, dispatcherHealth, failWork, heartbeatWorker, workerWatchdog } from "./core/workers";
import { configureAutomaticProject, createAutomaticProject, getAutomaticProject, getAutomaticProjectDetails, getOperationalSnapshot, getProjectSlot, listAutomaticProjects, processAutomaticProject, projectAvailability, projectLog, reconcileAutomaticProject, reopenAutomaticProject, validateProjectConsistency } from "./core/projects";
import { deleteProjectsPermanently, heartbeatProjectWorkflow, setProjectLifecycle, updateProjectWorkflow } from "./core/project-workflow";
import { appliedPolicies, createOperationalPolicy, detectOperationalGap, editOperationalPolicy, getOperationalGap, linkGapPolicy, listOperationalGaps, listOperationalPolicies, policyTelemetry, policyWorkspace, resolveGapAndLearn, rollbackPolicy, setPolicyStatus, testPolicy } from "./core/policies";
import { backfillLegacyProjects, claimNextSupervisorWork, configureSupervisor, decideSupervisorCandidate, heartbeatSupervisor, listSourceProfiles, listSupervisorCandidatesWithLinks, listSupervisorDecisions, nightlySummary, relinkItem, relinkItems, resolveSupervisorDecision, saveSourceProfile, setDefaultSourceProfile, setHostBlocked, setItemProcessingState, setProjectProcessingState, setSourceProfileStatus, supervisorLeaseTelemetry, supervisorPanel, supervisorStatus, supervisorWatchdog, updateCollectionSettings, updateCollectionSource, updateItemSearch, updateSourceProfile } from "./core/supervisor";
import { bindingStatus, listSafeSettings, updateSafeSetting } from "./core/settings";
import { configureStockPolicy, evaluateCollectionNeed, registerAssetConsultation, stockPanel, stockTextReport } from "./core/stock";
import { controlJobResult, enqueueApprovalsByItems, enqueueFastApproveProjectItems, enqueueSupervisorDecisions, rejectProjectItems, relinkProjectItems } from "./core/fast-control";
import { confirmPackageDownload, decideProjectThumbs, decideProjectTitles, getPackageLink, listReadyPackages, projectProductionPackage, projectThumbLinks, pushProjectTitles, queueFinalPackage } from "./core/production";
import { addProjectQaEvent, attachProjectScriptInline, getProjectFileLink, listProjectFiles, readProjectFile } from "./core/project-files";
import { createSourceRoutingPlan, executeUntilDivergence, getPlanDetails, getPlanExceptions, getPlanStatus, getSourceRoutingPlan, getWorkPacket, setPlanStatus, supervisorExchange, tickPlans } from "./core/plans";
import { collectionAnalysis, collectionReport, collectionStatus, configureCollectionSource, controlCollectionBatch, createCollectionBatch, enqueueCollection, listCollectionBatches, listCollectionSources } from "./core/collection";
import { importMediaByPreparedUpload, importZipByUrl, prepareZipUpload, queueZipImport, syncR2Uncataloged } from "./core/imports-v2";
import { addCandidatesToMaterializationItem, addMaterializationItems, applyTechnicalCorrectionCompat, assetsForQa, cancelMaterializationBatch, cleanMaterializationTemporaries, createContinuousMaterializationQueue, getMaterializationBatchStatus, getMaterializationItemStatus, materializationLog, materializeBatchCompat, registerMaterializationQa } from "./core/materialization-compat";
import { exportFrozenMaterializationBatch, getAssetExportLink, getAssetExportStatus, queueAssetExport } from "./core/asset-exports";
import { dataHealth } from "./core/data-health";
import { exploreR2 } from "./core/r2-explorer";
import { deleteMissingPendingMedia, repairPendingMedia, scanPendingMedia } from "./core/pending-r2-reconcile";
import { writeD1StructureManifest } from "./core/recovery-manifest";
import { heartbeatOperation, runtimeHeartbeatStatus, runtimeHeartbeatWatchdog } from "./core/heartbeats";
import { fastPushProjectCandidates, getProjectCollectionSnapshot, getQaWorkPacket, operationMaterializationTelemetry, submitQaDecisions } from "./core/collector-qa";

const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function requestFor(baseRequest: Request, path: string, init?: RequestInit) {
  return new Request(new URL(path, baseRequest.url), init);
}

function createServer(env: Env, request: Request) {
  const server = new McpServer({ name: "corvo-library-v2", version: "0.20.25" });

  server.registerTool("verificar_saude", {
    description: "Verifica o núcleo da Corvo Library V2 e confirma acesso ao D1/R2.",
    inputSchema: {},
  }, async () => {
    const [stats, firstObject] = await Promise.all([
      catalogStats(env),
      env.MEDIA.list({ limit: 1 }).then(() => true).catch(() => false),
    ]);
    return output({ ok: firstObject, architecture: "D1_R2_QUEUE", stats });
  });

  server.registerTool("auditar_integridade_d1", {
    description: "Audita integridade lógica do D1 sem alterar dados. Separa orfandades históricas preservadas de inconsistências criadas pela V2.",
    inputSchema: {},
  }, async () => output(await dataHealth(env)));

  server.registerTool("obter_contexto_biblioteca", {
    description: "Retorna o contexto do catálogo, contagens e universos diretamente do D1 da V2.",
    inputSchema: {},
  }, async () => {
    const [stats, universes] = await Promise.all([catalogStats(env), listUniverses(env)]);
    return output({ stats, universes: universes.map(item => item.name), universeFacets: universes });
  });

  server.registerTool("buscar_assets", {
    description: "Busca assets por texto, universo, tipo, status e uso. Mantém compatibilidade com a ferramenta histórica.",
    inputSchema: {
      texto: z.string().optional(),
      consulta: z.string().optional(),
      universo: z.string().optional(),
      tipo: z.string().optional(),
      status: z.string().optional(),
      nunca_usado: z.boolean().optional(),
      limite: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ texto, consulta, universo, tipo, status, nunca_usado, limite }) => {
    const params = new URLSearchParams({ limit: String(limite || 48) });
    if (texto || consulta) params.set("q", texto || consulta || "");
    if (universo) params.set("universe", universo);
    if (tipo) params.set("kind", tipo);
    if (status) params.set("status", status);
    if (nunca_usado) params.set("neverUsed", "true");
    return output(await listAssets(requestFor(request, `/assets?${params}`), env));
  });

  server.registerTool("obter_asset", {
    description: "Obtém um asset por AST-* com metadados e link temporário direto do R2.",
    inputSchema: { asset_id: z.string().min(1) },
  }, async ({ asset_id }) => output((await getAsset(request, asset_id, env)) || { error: "NOT_FOUND" }));


  server.registerTool("obter_historico_asset", {
    description: "Retorna até 500 registros de uso de um asset, em ordem decrescente de utilização.",
    inputSchema: { asset_id: z.string().min(1) },
  }, async ({ asset_id }) => output(await getAssetHistory(asset_id, env)));

  server.registerTool("listar_pendentes", {
    description: "Lista assets pendentes de catalogação ou revisão com previews temporários do R2.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  }, async ({ limite }) => {
    const params = new URLSearchParams({ status: "PENDING", limit: String(limite || 100) });
    return output((await listAssets(requestFor(request, `/assets?${params}`), env)).items);
  });

  server.registerTool("obter_pendentes_para_qa_catalogo", {
    description: "Retorna pendentes com links temporários de preview para QA visual, sem transportar binários pelo MCP.",
    inputSchema: { asset_ids: z.array(z.string()).max(20).optional(), limite: z.number().int().min(1).max(20).optional() },
  }, async ({ asset_ids, limite }) => {
    const max = limite || 20;
    if (asset_ids?.length) {
      const links = await getAssetLinks(request, asset_ids.slice(0, max), env);
      const dossiers: unknown[] = [];
      for (const item of links) {
        const asset = await getAsset(request, item.id, env);
        if (asset?.rawStatus?.startsWith("Pendente")) dossiers.push(asset);
      }
      return output({ total: dossiers.length, arquivos: dossiers });
    }
    const params = new URLSearchParams({ status: "PENDING", limit: String(max) });
    const result = await listAssets(requestFor(request, `/assets?${params}`), env);
    return output({ total: result.items.length, arquivos: result.items });
  });

  server.registerTool("catalogar_asset", {
    description: "Cria um asset no catálogo histórico apontando para um objeto que já existe no R2. A V2 valida o r2_key antes de gravar.",
    inputSchema: {
      asset_id: z.string().optional(), nome: z.string().min(1), r2_key: z.string().min(1), arquivo_original: z.string().min(1), mime_type: z.string().min(1),
      universo: z.string().optional(), tipo: z.string().optional(), sujeito: z.string().optional(), tags: z.array(z.string()).optional(), projeto_origem: z.string().optional(),
      referencia_roteiro: z.string().optional(), referencia_visual: z.string().optional(), fonte_url: z.string().optional(), nota_operacional: z.string().optional(), status_qa: z.string().optional(),
    },
  }, async (input) => output(await catalogAsset(request, input, env)));

  server.registerTool("editar_metadados", {
    description: "Atualiza somente campos semânticos permitidos de um asset; r2_key e IDs não são alterados por esta ferramenta.",
    inputSchema: {
      asset_id: z.string().min(1), nome: z.string().optional(), universo: z.string().optional(), tipo: z.string().optional(), sujeito: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(), projeto_origem: z.string().nullable().optional(), referencia_roteiro: z.string().nullable().optional(), referencia_visual: z.string().nullable().optional(),
      fonte_url: z.string().nullable().optional(), nota_operacional: z.string().nullable().optional(), status_qa: z.string().optional(),
    },
  }, async ({ asset_id, ...update }) => output(await updateAssetMetadata(request, asset_id, update, env)));

  server.registerTool("registrar_uso", {
    description: "Registra uma utilização e incrementa use_count de forma atômica no D1.",
    inputSchema: {
      asset_id: z.string().min(1), projeto: z.string().min(1), bloco: z.string().optional(), preset: z.string().optional(), slot: z.string().optional(), funcao: z.string().optional(),
      referencia_roteiro: z.string().optional(), observacao: z.string().optional(),
    },
  }, async (input) => output(await registerAssetUsage(request, input, env)));

  server.registerTool("registrar_uso_lote", {
    description: "Registra usos em lote preservando o histórico e contadores de cada asset.",
    inputSchema: { usos: z.array(z.object({
      asset_id: z.string().min(1), projeto: z.string().min(1), bloco: z.string().optional(), preset: z.string().optional(), slot: z.string().optional(), funcao: z.string().optional(),
      referencia_roteiro: z.string().optional(), observacao: z.string().optional(),
    })).min(1).max(200) },
  }, async ({ usos }) => {
    const results: unknown[] = [];
    for (const usage of usos) results.push(await registerAssetUsage(request, usage, env));
    return output({ registrados: results.filter(value => !(value && typeof value === "object" && "error" in value)).length, resultados: results });
  });

  server.registerTool("registrar_uso_asset", {
    description: "Alias histórico explícito de registrar_uso para manter compatibilidade sem duplicar lógica.",
    inputSchema: { asset_id: z.string().min(1), projeto: z.string().min(1), bloco: z.string().optional(), preset: z.string().optional(), slot: z.string().optional(), funcao: z.string().optional(), referencia_roteiro: z.string().optional(), observacao: z.string().optional() },
  }, async (input) => output(await registerAssetUsage(request, input, env)));

  server.registerTool("marcar_rejeitado", {
    description: "Move logicamente um asset para Rejeitado preservando previous_status e histórico.",
    inputSchema: { asset_id: z.string().min(1), motivo: z.string().min(1) },
  }, async ({ asset_id, motivo }) => output(await rejectAsset(request, asset_id, motivo, env)));

  server.registerTool("restaurar_asset", {
    description: "Restaura um asset rejeitado para previous_status ou Pendente.",
    inputSchema: { asset_id: z.string().min(1) },
  }, async ({ asset_id }) => output(await restoreAsset(request, asset_id, env)));

  server.registerTool("aprovar_pendentes_em_lote", {
    description: "Aprova até 200 assets pendentes em lote e registra a observação operacional.",
    inputSchema: { asset_ids: z.array(z.string()).min(1).max(200), observacao: z.string().optional() },
  }, async ({ asset_ids, observacao }) => output(await approvePendingAssets(request, asset_ids, observacao, env)));

  server.registerTool("listar_solicitacoes", {
    description: "Lista solicitações históricas preservadas no D1.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  }, async ({ limite }) => output(await listRequests(env, limite || 100)));

  server.registerTool("criar_solicitacao", {
    description: "Cria uma solicitação com itens em texto e contagem automática.",
    inputSchema: { projeto: z.string().min(1), itens: z.string().min(1) },
  }, async ({ projeto, itens }) => output(await createRequest(env, projeto, itens)));

  server.registerTool("atualizar_solicitacao", {
    description: "Atualiza projeto, itens e/ou status de uma solicitação existente.",
    inputSchema: { solicitacao_id: z.string().min(1), projeto: z.string().optional(), itens: z.string().optional(), status: z.string().optional() },
  }, async ({ solicitacao_id, ...input }) => output((await updateRequest(env, solicitacao_id, input)) || { error: "NOT_FOUND" }));

  server.registerTool("listar_lotes", {
    description: "Lista lotes históricos e atuais do D1.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  }, async ({ limite }) => output(await listBatches(env, limite || 100)));

  server.registerTool("criar_lote", {
    description: "Cria um lote e opcionalmente vincula assets existentes.",
    inputSchema: { nome: z.string().min(1), projeto: z.string().optional(), asset_ids: z.array(z.string()).max(500).optional() },
  }, async ({ nome, projeto, asset_ids }) => output(await createBatch(env, nome, projeto, asset_ids)));

  server.registerTool("obter_lote", {
    description: "Retorna o lote com seus assets e posições.",
    inputSchema: { lote_id: z.string().min(1) },
  }, async ({ lote_id }) => output((await getBatch(env, lote_id)) || { error: "NOT_FOUND" }));

  server.registerTool("adicionar_assets_ao_lote", {
    description: "Vincula assets existentes a um lote preservando ordem.",
    inputSchema: { lote_id: z.string().min(1), asset_ids: z.array(z.string()).min(1).max(500) },
  }, async ({ lote_id, asset_ids }) => output((await addAssetsToBatch(env, lote_id, asset_ids)) || { error: "NOT_FOUND" }));

  server.registerTool("remover_assets_do_lote", {
    description: "Remove vínculos de assets de um lote sem apagar os assets físicos ou lógicos.",
    inputSchema: { lote_id: z.string().min(1), asset_ids: z.array(z.string()).min(1).max(500) },
  }, async ({ lote_id, asset_ids }) => output((await removeAssetsFromBatch(env, lote_id, asset_ids)) || { error: "NOT_FOUND" }));

  server.registerTool("atualizar_status_lote", {
    description: "Atualiza o status de um lote.",
    inputSchema: { lote_id: z.string().min(1), status: z.string().min(1) },
  }, async ({ lote_id, status }) => output((await updateBatchStatus(env, lote_id, status)) || { error: "NOT_FOUND" }));

  server.registerTool("gerar_manifesto_lote", {
    description: "Gera manifest.txt do lote e grava diretamente no R2 usando binding nativo.",
    inputSchema: { lote_id: z.string().min(1) },
  }, async ({ lote_id }) => output((await generateBatchManifest(env, lote_id)) || { error: "NOT_FOUND" }));

  server.registerTool("listar_importacoes", {
    description: "Lista registros históricos de importação preservados no D1.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  }, async ({ limite }) => output(await listImports(env, limite || 100)));

  server.registerTool("fast_push_urls_lote", {
    description: "Enfileira URLs para materialização assíncrona. Retorna imediatamente um operation_id; o MCP não baixa os arquivos.",
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(200),
      universo: z.string().optional(),
      sujeito: z.string().optional(),
      projeto_id: z.string().optional(),
      item_id: z.string().optional(),
      tags: z.array(z.string()).max(40).optional(),
    },
  }, async ({ urls, universo, sujeito, projeto_id, item_id, tags }) => {
    const synthetic = requestFor(request, "/fast-push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: urls.map((url: string) => ({ url, universe: universo, subject: sujeito, projectId: projeto_id, itemId: item_id, tags })) }),
    });
    return output(await fastPush(synthetic, env));
  });

  server.registerTool("fast_push_project_candidates", {
    description: "FAST PUSH consolidado por projeto/cena. Se item_id/cena ainda não existir, a Library cria/upserta a cena idempotentemente no projeto, aplica target_candidates/required_approved, enfileira apenas o necessário e mantém excedentes DISCOVERED como reserva. Nunca retorna sucesso silencioso com zero itens.",
    inputSchema: {
      project_id: z.string().min(1),
      operation_id: z.string().optional(),
      items: z.array(z.object({
        item_id: z.string().min(1),
        target_candidates: z.number().int().min(1).max(100).optional(),
        required_approved: z.number().int().min(1).max(100).optional(),
        universo: z.string().optional(),
        sujeito: z.string().optional(),
        tags: z.array(z.string()).max(40).optional(),
        urls: z.array(z.string().url()).min(1).max(50),
      })).min(1).max(50),
    },
  }, async (v) => output(await fastPushProjectCandidates(env, {
    projectId:v.project_id,
    operationId:v.operation_id,
    items:v.items.map((item: {item_id:string;target_candidates?:number;required_approved?:number;universo?:string;sujeito?:string;tags?:string[];urls:string[]})=>({itemId:item.item_id,targetCandidates:item.target_candidates,requiredApproved:item.required_approved,universe:item.universo,subject:item.sujeito,tags:item.tags,urls:item.urls})),
  })));

  server.registerTool("get_collection_snapshot", {
    description: "Snapshot consolidado da coleta por cena. MATERIALIZED/APPROVED/REJECTED contam como materialização histórica; retorna apenas cenas COMPLETE/NEEDS_MORE e telemetria útil. wait_ms faz long-poll curto dentro de uma única chamada.",
    inputSchema: {
      project_id: z.string().min(1),
      operation_id: z.string().optional(),
      item_ids: z.array(z.string()).max(100).optional(),
      wait_ms: z.number().int().min(0).max(5000).optional(),
    },
  }, async (v) => output(await getProjectCollectionSnapshot(env,{projectId:v.project_id,operationId:v.operation_id,itemIds:v.item_ids,waitMs:v.wait_ms})));

  server.registerTool("get_qa_work_packet", {
    description: "Pacote compacto para o Analista. Retorna somente cenas READY_FOR_QA e somente candidatas MATERIALIZED com preview; nunca inclui QUEUED/DOWNLOADING/RETRYING/FAILED nem logs administrativos.",
    inputSchema: {
      project_id: z.string().optional(),
      limite_cenas: z.number().int().min(1).max(30).optional(),
      candidatas_por_cena: z.number().int().min(1).max(50).optional(),
    },
  }, async (v) => output(await getQaWorkPacket(request,env,{projectId:v.project_id,limitItems:v.limite_cenas,candidatesPerItem:v.candidatas_por_cena})));

  server.registerTool("submit_qa_decisions", {
    description: "Decisões QA em lote sobre candidatas MATERIALIZED. APPROVE promove incoming/ para assets/ e cria AST-*; REJECT remove o temporário. Retorna assets, deleções e requisitos restantes por cena.",
    inputSchema: {
      decisions: z.array(z.object({candidate_id:z.string().min(1),decision:z.enum(["APPROVE","REJECT"]),observation:z.string().optional()})).min(1).max(100),
    },
  }, async (v) => output(await submitQaDecisions(request,env,{decisions:v.decisions.map((d: {candidate_id:string;decision:"APPROVE"|"REJECT";observation?:string})=>({candidateId:d.candidate_id,decision:d.decision,observation:d.observation}))})));

  server.registerTool("get_materialization_telemetry", {
    description: "Telemetria compacta de uma operação: accepted/materialized/failed, queue wait, download, R2, D1, média e p95 sem retornar log histórico extenso.",
    inputSchema: { operation_id:z.string().min(1) },
  }, async (v) => output((await operationMaterializationTelemetry(env,v.operation_id)) || {error:"NOT_FOUND"}));

  server.registerTool("materializar_urls_lote", {
    description: "Alias V2 do FAST PUSH: agenda materialização de URLs em Queue e retorna operation_id sem transportar binários pelo MCP.",
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(200),
      universo: z.string().optional(),
      sujeito: z.string().optional(),
    },
  }, async ({ urls, universo, sujeito }) => {
    const synthetic = requestFor(request, "/fast-push", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ urls:urls.map((url: string) => ({ url, universe:universo, subject:sujeito })) }) });
    return output(await fastPush(synthetic, env));
  });

  server.registerTool("obter_resultado_operacao", {
    description: "Consulta progresso e resultado de uma operação FAST PUSH/materialização.",
    inputSchema: { operation_id: z.string().min(1) },
  }, async ({ operation_id }) => output((await getOperation(operation_id, env)) || { error: "NOT_FOUND" }));

  server.registerTool("listar_inbox_candidatas", {
    description: "Lista candidatas materializadas, em retry, falhas, aprovadas ou rejeitadas.",
    inputSchema: {
      status: z.enum(["MATERIALIZED", "RETRYING", "FAILED", "APPROVED", "REJECTED"]).optional(),
      limite: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ status, limite }) => {
    const params = new URLSearchParams({ status: status || "MATERIALIZED", limit: String(limite || 100) });
    return output({ items: await listCandidates(requestFor(request, `/candidates?${params}`), env) });
  });

  server.registerTool("aprovar_candidatas_fast_push_lote", {
    description: "Aprova candidatas materializadas. Move mídia de incoming/ para assets/, cria AST-* no D1 histórico e remove o temporário.",
    inputSchema: { candidate_ids: z.array(z.string()).min(1).max(100) },
  }, async ({ candidate_ids }) => {
    const results: unknown[] = [];
    for (const candidateId of candidate_ids) results.push({ candidateId, ...(await approveCandidate(candidateId, env)) });
    return output({ results });
  });

  server.registerTool("rejeitar_candidatas_fast_push_lote", {
    description: "Rejeita candidatas e remove o objeto temporário do R2 quando existir.",
    inputSchema: { candidate_ids: z.array(z.string()).min(1).max(100) },
  }, async ({ candidate_ids }) => {
    const results: unknown[] = [];
    for (const candidateId of candidate_ids) results.push({ candidateId, ...(await rejectCandidate(candidateId, env)) });
    return output({ results });
  });

  server.registerTool("obter_link_download", {
    description: "Gera link temporário direto para o R2 por asset, sem proxy de credenciais ou bytes pelo MCP.",
    inputSchema: { asset_id: z.string().min(1), validade_minutos: z.number().int().min(1).max(60).optional() },
  }, async ({ asset_id, validade_minutos }) => output((await getAssetLink(request, asset_id, env, (validade_minutos || 5) * 60)) || { error: "NOT_FOUND" }));

  server.registerTool("obter_links_download_lote", {
    description: "Gera links temporários de download/preview para assets existentes, sem expor credenciais do R2.",
    inputSchema: { asset_ids: z.array(z.string()).min(1).max(200) },
  }, async ({ asset_ids }) => output({ links: await getAssetLinks(request, asset_ids, env) }));

  server.registerTool("listar_projetos_automaticos", {
    description: "Lista resumida de projetos automáticos preservados no D1, com paginação por cursor.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() },
  }, async ({ limite, cursor }) => output(await listAutomaticProjects(env, limite || 50, cursor)));

  server.registerTool("criar_projeto_automatico", {
    description: "Cria um projeto automático V2 usando a tabela histórica e ID opcional idempotente.",
    inputSchema: { projeto_id:z.string().optional(), nome:z.string().min(1), project_domain:z.string().optional(), prioridade_fila:z.number().int().optional(), automatico:z.boolean().optional(), biblioteca_primeiro:z.boolean().optional(), busca_externa:z.boolean().optional(), zip_automatico:z.boolean().optional(), excluir_zip_ao_concluir:z.boolean().optional() },
  }, async (input) => output(await createAutomaticProject(env, input)));

  server.registerTool("obter_projeto_automatico", {
    description: "Obtém o resumo materializado de um projeto automático sem varrer R2.",
    inputSchema: { projeto_id:z.string().min(1), execution_id:z.string().optional() },
  }, async ({ projeto_id }) => output((await getAutomaticProject(env,projeto_id)) || {error:"NOT_FOUND"}));

  server.registerTool("obter_detalhes_projeto_automatico", {
    description: "Obtém projeto, arquivos, itens e eventos históricos quando o detalhe completo é necessário.",
    inputSchema: { projeto_id:z.string().min(1), execution_id:z.string().optional() },
  }, async ({ projeto_id }) => output((await getAutomaticProjectDetails(env,projeto_id)) || {error:"NOT_FOUND"}));

  server.registerTool("obter_snapshot_operacional", {
    description: "Retorna snapshot compacto do projeto e respeita since_version para evitar tráfego desnecessário.",
    inputSchema: { projeto_id:z.string().min(1), since_version:z.number().int().optional(), limite_pacote:z.number().int().optional(), execution_id:z.string().optional() },
  }, async ({ projeto_id, since_version }) => output((await getOperationalSnapshot(env,projeto_id,since_version)) || {error:"NOT_FOUND"}));

  server.registerTool("validar_consistencia", {
    description: "Executa uma checagem de integridade D1↔R2 e identifica r2_key compartilhadas sem alterar dados.",
    inputSchema: { limite: z.number().int().min(1).max(500).optional(), projeto_id: z.string().optional(), execution_id: z.string().optional() },
  }, async ({ limite }) => output({
    storage: await integritySample(env, limite || 100),
    duplicateR2Keys: await findDuplicateR2Keys(env, 100),
    stats: await catalogStats(env),
  }));

  server.registerTool("obter_painel_estoque", {
    description: "Retorna painel de estoque, giro, universos e políticas sem varrer o R2.",
    inputSchema: {},
  }, async () => output(await stockPanel(env)));

  server.registerTool("exportar_txt_estoque_giro", { description:"Gera relatório textual de estoque/giro no retorno MCP, sem criar arquivo no R2.", inputSchema:{ aba:z.string().optional() } }, async()=>output({text:await stockTextReport(env)}));
  server.registerTool("configurar_politica_estoque", { description:"Cria ou atualiza política semântica de estoque.", inputSchema:{ id:z.string().optional(), conceito:z.string().min(1), universo:z.string().optional(), tipo:z.string().optional(), minimo:z.number().int().min(0).optional(), ideal:z.number().int().min(0).optional(), maximo:z.number().int().min(0).optional(), ativa:z.boolean().optional() } }, async(v)=>output(await configureStockPolicy(env,{id:v.id,concept:v.conceito,universe:v.universo,kind:v.tipo,minimum:v.minimo,ideal:v.ideal,maximum:v.maximo,active:v.ativa})));
  server.registerTool("registrar_consulta_asset", { description:"Registra consulta/seleção de asset para telemetria sem alterar o asset.", inputSchema:{ asset_id:z.string().optional(), conceito:z.string().min(1), projeto:z.string().optional(), query:z.string().optional(), selecionado:z.boolean().optional() } }, async(v)=>output(await registerAssetConsultation(env,{assetId:v.asset_id,concept:v.conceito,project:v.projeto,query:v.query,selected:v.selecionado})));
  server.registerTool("avaliar_necessidade_coleta", { description:"Compara estoque aprovado com política semântica e informa se é necessário coletar.", inputSchema:{ conceito:z.string().min(1), universo:z.string().optional(), tipo:z.string().optional() } }, async(v)=>output(await evaluateCollectionNeed(env,{concept:v.conceito,universe:v.universo,kind:v.tipo})));


  server.registerTool("listar_destinos_fast_push_projeto", {
    description: "Lista itens de um projeto que ainda podem receber candidatas via FAST PUSH, sem transportar arquivos pelo MCP.",
    inputSchema: { projeto_id: z.string().min(1), limite: z.number().int().min(1).max(500).optional() },
  }, async ({ projeto_id, limite }) => {
    const details = await getAutomaticProjectDetails(env, projeto_id);
    if (!details) return output({ error: "NOT_FOUND" });
    const terminal = new Set(["APROVADO","APPROVED","FROZEN","CONGELADO","FAILED","FALHOU","CANCELADO"]);
    const items = ((details.items || []) as Record<string, unknown>[]).filter((item: Record<string, unknown>) => !terminal.has(String(item.status || "").toUpperCase())).slice(0, limite || 200)
      .map((item: Record<string, unknown>) => ({ item_id:item.id, item_key:item.item_key, term:item.term, universe:item.universe, target_file:item.target_file, status:item.status, priority:item.priority }));
    return output({ projeto_id, total: items.length, destinos: items });
  });

  server.registerTool("obter_candidatas_qa_links", {
    description: "Retorna candidatas materializadas com previews temporários do R2 para QA visual.",
    inputSchema: { limite: z.number().int().min(1).max(100).optional(), projeto_id: z.string().optional() },
  }, async ({ limite, projeto_id }) => {
    const params = new URLSearchParams({ status:"MATERIALIZED", limit:String(limite || 50) });
    const items = await listCandidates(requestFor(request, `/candidates?${params}`), env);
    return output({ items: projeto_id ? items.filter(item => item.projectId === projeto_id) : items });
  });

  server.registerTool("obter_work_packet_lite", {
    description: "Pacote operacional compacto: projeto, contagens, próximos itens e candidatas materializadas.",
    inputSchema: { projeto_id: z.string().min(1), limite: z.number().int().min(1).max(100).optional() },
  }, async ({ projeto_id, limite }) => {
    const [snapshot, details] = await Promise.all([getOperationalSnapshot(env, projeto_id), getAutomaticProjectDetails(env, projeto_id)]);
    if (!details) return output({ error:"NOT_FOUND" });
    const candidateRows = await env.DB.prepare("SELECT id,operation_id,item_id,universe,subject,status,r2_key,mime_type,size_bytes,attempts,updated_at FROM v2_ingest_candidates WHERE project_id=? ORDER BY updated_at DESC LIMIT ?")
      .bind(projeto_id, limite || 50).all<Record<string,unknown>>();
    return output({ snapshot, items:(details.items||[]).slice(0,limite||50), candidates:candidateRows.results||[] });
  });

  server.registerTool("obter_resumo_operacional_curto", {
    description: "Resumo curto do pipeline V2 para acompanhamento rápido.",
    inputSchema: { projeto_id: z.string().optional() },
  }, async ({ projeto_id }) => {
    const [telemetry, latest, risk] = await Promise.all([pipelineTelemetry(env), latestOperation(env), operationalRisk(env)]);
    const project = projeto_id ? await getOperationalSnapshot(env,projeto_id) : null;
    return output({ project, latestOperation:latest, risk, telemetry });
  });

  server.registerTool("importar_candidatas_url_lote", {
    description: "Alias compatível do FAST PUSH: importa candidatas por URL via Queue, sem download síncrono no MCP.",
    inputSchema: { urls:z.array(z.string().url()).min(1).max(200), projeto_id:z.string().optional(), item_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).max(40).optional() },
  }, async ({ urls, projeto_id, item_id, universo, sujeito, tags }) => {
    const synthetic=requestFor(request,"/fast-push",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({urls:urls.map((url: string)=>({url,projectId:projeto_id,itemId:item_id,universe:universo,subject:sujeito,tags}))})});
    return output(await fastPush(synthetic,env));
  });

  server.registerTool("fast_decidir_candidatas_lote", {
    description: "Aplica aprovações/rejeições em lote nas candidatas FAST PUSH já materializadas.",
    inputSchema: { decisoes:z.array(z.object({candidate_id:z.string().min(1),decisao:z.enum(["APROVAR","REJEITAR"])})).min(1).max(100) },
  }, async ({ decisoes }) => {
    const resultados: unknown[]=[];
    for(const decisao of decisoes){ const value=decisao.decisao==="APROVAR"?await approveCandidate(decisao.candidate_id,env):await rejectCandidate(decisao.candidate_id,env); resultados.push({candidate_id:decisao.candidate_id,decisao:decisao.decisao,...value}); }
    return output({resultados});
  });

  server.registerTool("decidir_candidatas_lote", {
    description: "Compatibilidade: decide candidatas FAST PUSH em lote.",
    inputSchema: { decisoes:z.array(z.object({candidate_id:z.string().min(1),decisao:z.enum(["APROVAR","REJEITAR"])})).min(1).max(100) },
  }, async ({ decisoes }) => {
    const resultados: unknown[]=[];
    for(const decisao of decisoes){ const value=decisao.decisao==="APROVAR"?await approveCandidate(decisao.candidate_id,env):await rejectCandidate(decisao.candidate_id,env); resultados.push({candidate_id:decisao.candidate_id,...value}); }
    return output({resultados});
  });

  server.registerTool("aprovar_candidatas_lote", {
    description: "Aprova candidatas FAST PUSH em lote.",
    inputSchema: { candidate_ids:z.array(z.string()).min(1).max(100) },
  }, async ({ candidate_ids }) => { const resultados: unknown[]=[]; for(const candidate_id of candidate_ids) resultados.push({candidate_id,...await approveCandidate(candidate_id,env)}); return output({resultados}); });

  server.registerTool("rejeitar_candidatas_lote", {
    description: "Rejeita candidatas FAST PUSH em lote.",
    inputSchema: { candidate_ids:z.array(z.string()).min(1).max(100) },
  }, async ({ candidate_ids }) => { const resultados: unknown[]=[]; for(const candidate_id of candidate_ids) resultados.push({candidate_id,...await rejectCandidate(candidate_id,env)}); return output({resultados}); });


  server.registerTool("importar_candidata_arquivo_fast_push", {
    description: "Confirma um upload direto já armazenado no R2 e o transforma em candidata MATERIALIZED, sem transportar bytes pelo MCP.",
    inputSchema: { upload_id:z.string().min(1) },
  }, async ({upload_id}) => output(await confirmDirectUpload(env,upload_id)));

  server.registerTool("vincular_candidatas_fast_push_ao_projeto", {
    description: "Vincula candidatas V2 existentes a um projeto/item sem duplicar mídia no R2.",
    inputSchema: { candidate_ids:z.array(z.string()).min(1).max(200), projeto_id:z.string().min(1), item_id:z.string().optional() },
  }, async ({candidate_ids,projeto_id,item_id}) => output(await linkCandidatesToProject(env,candidate_ids,projeto_id,item_id)));

  server.registerTool("excluir_candidatas_lote", {
    description: "Exclui candidatas não aprovadas e remove apenas seus objetos temporários incoming/. Assets aprovados são imutáveis por esta ferramenta.",
    inputSchema: { candidate_ids:z.array(z.string()).min(1).max(200) },
  }, async ({candidate_ids}) => output(await deleteIngestCandidates(env,candidate_ids)));

  server.registerTool("fast_push_thumbs_url_lote", {
    description: "FAST PUSH especializado em thumbnails por URL. Usa a mesma Queue/R2 e adiciona a tag thumb.",
    inputSchema: { urls:z.array(z.string().url()).min(1).max(200), projeto_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional() },
  }, async ({urls,projeto_id,universo,sujeito}) => {
    const synthetic=requestFor(request,"/fast-push",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({urls:urls.map((url: string)=>({url,projectId:projeto_id,universe:universo,subject:sujeito,tags:["thumb"]}))})}); return output(await fastPush(synthetic,env));
  });

  server.registerTool("fast_push_generated_media", {
    description: "Recebe URLs de mídia gerada e agenda materialização assíncrona. Para bytes locais use preparar_upload_midia + confirmar_upload_midia.",
    inputSchema: { urls:z.array(z.string().url()).min(1).max(200), projeto_id:z.string().optional(), item_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).optional() },
  }, async ({urls,projeto_id,item_id,universo,sujeito,tags}) => {
    const synthetic=requestFor(request,"/fast-push",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({urls:urls.map((url: string)=>({url,projectId:projeto_id,itemId:item_id,universe:universo,subject:sujeito,tags:[...(tags||[]),"generated"]}))})}); return output(await fastPush(synthetic,env));
  });

  server.registerTool("preparar_upload_midia", {
    description: "Cria ticket e URL temporária assinada para PUT direto no Worker→R2. Não revela credenciais Cloudflare e não transporta o arquivo pelo MCP.",
    inputSchema: { arquivo:z.string().min(1), mime_type:z.string().optional(), tamanho_maximo:z.number().int().min(1024).max(104857600).optional(), projeto_id:z.string().optional(), item_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).max(40).optional(), validade_segundos:z.number().int().min(60).max(3600).optional() },
  }, async ({arquivo,mime_type,tamanho_maximo,projeto_id,item_id,universo,sujeito,tags,validade_segundos}) => output(await prepareDirectUpload(request,env,{fileName:arquivo,mimeType:mime_type,maxBytes:tamanho_maximo,uploadType:"CANDIDATE",projectId:projeto_id,itemId:item_id,universe:universo,subject:sujeito,tags,ttlSeconds:validade_segundos})));

  server.registerTool("confirmar_upload_midia", {
    description: "Confirma ticket STORED e cria candidata materializada ou arquivo de projeto de forma idempotente.",
    inputSchema: { upload_id:z.string().min(1) },
  }, async ({upload_id}) => output(await confirmDirectUpload(env,upload_id)));

  server.registerTool("obter_status_upload_midia", {
    description: "Diagnóstico V2 do ticket de upload direto.",
    inputSchema: { upload_id:z.string().min(1) },
  }, async ({upload_id}) => output((await getDirectUpload(env,upload_id))||{error:"NOT_FOUND"}));

  server.registerTool("materializar_url", {
    description: "Materializa uma única URL de forma assíncrona via Queue e retorna operation_id imediatamente.",
    inputSchema: { url:z.string().url(), projeto_id:z.string().optional(), item_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).optional() },
  }, async ({ url,projeto_id,item_id,universo,sujeito,tags }) => {
    const synthetic=requestFor(request,"/fast-push",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({urls:[{url,projectId:projeto_id,itemId:item_id,universe:universo,subject:sujeito,tags}]})}); return output(await fastPush(synthetic,env));
  });

  server.registerTool("obter_status_materializacao", {
    description: "Consulta status por candidate_id V2 ou por batch_id/item_id/materialization_id histórico.",
    inputSchema: { candidate_id:z.string().optional(), materialization_id:z.string().optional(), batch_id:z.string().optional(), item_id:z.string().optional() },
  }, async (v) => {
    if(v.candidate_id){const candidate=await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE id=?").bind(v.candidate_id).first<Record<string,unknown>>();return output(candidate?{candidate,events:await listIngestEvents(env,{candidateId:v.candidate_id,limit:100})}:{error:"NOT_FOUND"});}
    return output((await getMaterializationItemStatus(env,{batchId:v.batch_id,itemId:v.item_id,materializationId:v.materialization_id}))||{error:"NOT_FOUND"});
  });

  server.registerTool("obter_status_lote_materializacao", {
    description: "Consulta lote histórico por batch_id ou operação FAST PUSH por operation_id.",
    inputSchema: { batch_id:z.string().optional(), operation_id:z.string().optional(), execution_id:z.string().optional() },
  }, async (v) => {
    if(v.batch_id)return output((await getMaterializationBatchStatus(env,v.batch_id))||{error:"NOT_FOUND"});
    if(!v.operation_id)return output({error:"BATCH_OR_OPERATION_REQUIRED"});
    const operation=await getOperation(v.operation_id,env); if(!operation)return output({error:"NOT_FOUND"});
    const rows=await env.DB.prepare("SELECT * FROM v2_ingest_candidates WHERE operation_id=? ORDER BY updated_at DESC LIMIT 500").bind(v.operation_id).all<Record<string,unknown>>();
    return output({operation,candidates:rows.results||[],events:await listIngestEvents(env,{operationId:v.operation_id,limit:200})});
  });

  server.registerTool("retry_item_materializacao", {
    description: "Retoma candidate FAILED diretamente ou resolve a última candidata falha por batch/item.",
    inputSchema: { candidate_id:z.string().optional(), batch_id:z.string().optional(), item_id:z.string().optional(), projeto_id:z.string().optional(), execution_id:z.string().optional(), reiniciar_candidatas:z.boolean().optional(), forcar:z.boolean().optional() },
  }, async (v) => {
    let candidateId=v.candidate_id;
    if(!candidateId&&v.batch_id&&v.item_id){const c=await env.DB.prepare("SELECT id FROM v2_ingest_candidates WHERE item_id=? AND status='FAILED' ORDER BY updated_at DESC LIMIT 1").bind(v.item_id).first<{id:string}>();candidateId=c?.id;}
    return output(candidateId?await retryIngestCandidate(candidateId,env):{error:"FAILED_CANDIDATE_NOT_FOUND"});
  });

  server.registerTool("obter_log_materializacao", {
    description: "Retorna log por lote/item histórico ou por operação/candidata V2.",
    inputSchema: { batch_id:z.string().optional(), item_id:z.string().optional(), operation_id:z.string().optional(), candidate_id:z.string().optional(), limite:z.number().int().min(1).max(500).optional() },
  }, async (v) => {if(v.batch_id)return output((await materializationLog(env,v.batch_id,v.item_id))||{error:"NOT_FOUND"});return output({items:await listIngestEvents(env,{operationId:v.operation_id,candidateId:v.candidate_id,limit:v.limite||100})});});

  server.registerTool("obter_host_health", {
    description: "Retorna saúde e circuit breaker dos hosts observados durante materialização.",
    inputSchema: { limite:z.number().int().min(1).max(500).optional() },
  }, async ({limite}) => output({items:await listHostHealth(env,limite||100)}));

  server.registerTool("probar_url_controlada", {
    description: "Executa probe HEAD controlado com proteção SSRF e registra saúde do host.",
    inputSchema: { url:z.string().url(), timeout_ms:z.number().int().min(1000).max(30000).optional() },
  }, async ({url,timeout_ms}) => output(await probeRemoteUrl(env,url,timeout_ms||10000)));

  server.registerTool("obter_estatisticas_materializacao", {
    description: "Agrega estados, bytes, tentativas, operações e saúde de hosts da materialização V2.",
    inputSchema: {},
  }, async () => output(await getMaterializationStats(env)));

  server.registerTool("procurar_duplicata_hash", {
    description: "Procura SHA-256 já existente no catálogo e em arquivos materializados históricos.",
    inputSchema: { sha256:z.string().min(16) },
  }, async ({sha256}) => output(await findDuplicateHash(env,sha256)));

  server.registerTool("resolver_url", {
    description: "Resolve URL externa de forma controlada e retorna a URL final após redirects, sem materializar o arquivo.",
    inputSchema: { url:z.string().url(), timeout_ms:z.number().int().min(1000).max(30000).optional() },
  }, async ({url,timeout_ms}) => output(await probeRemoteUrl(env,url,timeout_ms||10000)));

  server.registerTool("testar_url", {
    description: "Testa acessibilidade, status HTTP e MIME de uma URL com proteção SSRF.",
    inputSchema: { url:z.string().url(), timeout_ms:z.number().int().min(1000).max(30000).optional() },
  }, async ({url,timeout_ms}) => output(await probeRemoteUrl(env,url,timeout_ms||10000)));

  server.registerTool("listar_adapters", {
    description: "Lista adaptadores de materialização ativos na V2.",
    inputSchema: {},
  }, async () => output({items:listAdapters()}));

  server.registerTool("obter_ranking_hosts", {
    description: "Ranking de hosts por sucesso/falha e estado de circuito.",
    inputSchema: { limite:z.number().int().min(1).max(500).optional() },
  }, async ({limite}) => output({items:await listHostHealth(env,limite||100)}));

  server.registerTool("obter_telemetria_pipeline", {
    description: "Telemetria consolidada de projetos, workers, filas, estágios e FAST PUSH.",
    inputSchema: {},
  }, async () => output(await pipelineTelemetry(env)));

  server.registerTool("heartbeat_operacao", {
    description: "Registra/renova heartbeat de uma operação MCP longa. A mesma operação só pode ser renovada pelo owner_id + execution_id que possui o heartbeat ativo; takeover de expirado exige reclaim_expired=true.",
    inputSchema: { operation_id:z.string().min(1), owner_id:z.string().min(1), execution_id:z.string().min(1), ttl_seconds:z.number().int().min(30).max(3600).optional(), reclaim_expired:z.boolean().optional(), metadata:z.record(z.string(),z.unknown()).optional() },
  }, async(v)=>output(await heartbeatOperation(env,{operationId:v.operation_id,ownerId:v.owner_id,executionId:v.execution_id,ttlSeconds:v.ttl_seconds,reclaimExpired:v.reclaim_expired,metadata:v.metadata})));

  server.registerTool("obter_status_heartbeats", {
    description: "Mostra heartbeats de workers, Supervisor e operações com último sinal, expiração e tempo restante de lease.",
    inputSchema: { scope_type:z.enum(["WORKER","SUPERVISOR","OPERATION"]).optional(), limite:z.number().int().min(1).max(500).optional() },
  }, async(v)=>output(await runtimeHeartbeatStatus(env,{scopeType:v.scope_type,limit:v.limite})));

  server.registerTool("executar_watchdog_heartbeats", {
    description: "Marca heartbeats genéricos vencidos como EXPIRED. Os watchdogs nativos de Worker/Supervisor continuam responsáveis por requeue/abandono dos respectivos leases.",
    inputSchema: {},
  }, async()=>output(await runtimeHeartbeatWatchdog(env)));

  server.registerTool("assumir_proximo_trabalho", {
    description: "Lease atômico do próximo worker_work_item READY compatível com tipo/domínio do worker.",
    inputSchema: { worker_id:z.string().min(1), worker_type:z.string().min(1), worker_domain:z.string().optional(), execution_id:z.string().optional(), lease_seconds:z.number().int().min(30).max(1800).optional(), projeto_id:z.string().optional() },
  }, async ({worker_id,worker_type,worker_domain,execution_id,lease_seconds,projeto_id}) => output(await claimNextWork(env,{workerId:worker_id,workerType:worker_type,workerDomain:worker_domain,executionId:execution_id,leaseSeconds:lease_seconds,projectId:projeto_id})));

  server.registerTool("heartbeat_worker", {
    description: "Renova atomicamente um lease de worker ativo. Exige work_item_id + worker_id + execution_id corretos; não revive lease expirado nem permite renovar trabalho de outro agente.",
    inputSchema: { work_item_id:z.string().min(1), worker_id:z.string().min(1), execution_id:z.string().min(1), lease_seconds:z.number().int().min(30).max(1800).optional() },
  }, async ({work_item_id,worker_id,execution_id,lease_seconds}) => output(await heartbeatWorker(env,{workItemId:work_item_id,workerId:worker_id,executionId:execution_id,leaseSeconds:lease_seconds})));

  server.registerTool("concluir_trabalho_worker", {
    description: "Conclui trabalho apenas se o worker possuir o lease atual.",
    inputSchema: { work_item_id:z.string().min(1), worker_id:z.string().min(1), resultado:z.any().optional() },
  }, async ({work_item_id,worker_id,resultado}) => output(await completeWork(env,{workItemId:work_item_id,workerId:worker_id,result:resultado})));

  server.registerTool("registrar_falha_worker", {
    description: "Registra falha de worker e reenvia para READY quando ainda há tentativas disponíveis.",
    inputSchema: { work_item_id:z.string().min(1), worker_id:z.string().min(1), motivo:z.string().min(1), retry:z.boolean().optional(), atraso_segundos:z.number().int().min(0).max(3600).optional() },
  }, async ({work_item_id,worker_id,motivo,retry,atraso_segundos}) => output(await failWork(env,{workItemId:work_item_id,workerId:worker_id,reason:motivo,retry,delaySeconds:atraso_segundos})));

  server.registerTool("executar_watchdog_workers", {
    description: "Recupera leases expirados e sessões de worker abandonadas.",
    inputSchema: {},
  }, async () => output(await workerWatchdog(env)));

  server.registerTool("obter_saude_dispatcher", {
    description: "Mostra filas READY/LEASED, sessões, capacidade e leases expirados.",
    inputSchema: {},
  }, async () => output(await dispatcherHealth(env)));

  server.registerTool("obter_painel_operacional_producao", {
    description: "Painel operacional consolidado da produção V2.",
    inputSchema: {},
  }, async () => output({dispatcher:await dispatcherHealth(env),pipeline:await pipelineTelemetry(env),materialization:await getMaterializationStats(env),risk:await operationalRisk(env),latestOperation:await latestOperation(env)}));

  server.registerTool("obter_dashboard_gerencial", {
    description: "Dashboard gerencial compacto com catálogo, produção, risco e integridade mais recente.",
    inputSchema: {},
  }, async () => output({catalog:await catalogStats(env),pipeline:await pipelineTelemetry(env),risk:await operationalRisk(env),storageAudit:await latestStorageAudit(env)}));

  server.registerTool("configurar_limite_workers", {
    description: "Configura limite de workers por tipo e domínio no D1 histórico.",
    inputSchema: { worker_type:z.string().min(1), worker_domain:z.string().optional(), max_workers:z.number().int().min(1).max(100), max_por_projeto:z.number().int().min(1).max(100).optional(), ativo:z.boolean().optional() },
  }, async ({worker_type,worker_domain,max_workers,max_por_projeto,ativo}) => output(await configureWorkerLimit(env,{workerType:worker_type,workerDomain:worker_domain,maxWorkers:max_workers,maxPerProject:max_por_projeto,enabled:ativo})));

  server.registerTool("obter_slot_projeto", {
    description: "Snapshot operacional completo de um projeto-slot: lifecycle, tags simultâneas/heartbeats, roteiro, thumbs (max 3), títulos (max 3), referências, cenas/candidatas, aprovadas e ZIP final.",
    inputSchema: { projeto_id:z.string().min(1) },
  }, async ({projeto_id}) => output((await getProjectSlot(env,projeto_id))||{error:"NOT_FOUND"}));

  server.registerTool("atualizar_estados_projeto", {
    description: "Coordena tags simultâneas do projeto. Permite ativar/remover READ, REFERENCE_ANALYSIS_WORKING, REFERENCE_CHECKED, COLLECTOR_WORKING, COLLECTOR_FINISHED, VISUAL_ANALYST_WORKING, VISUAL_ANALYST_FINISHED, DOWNLOADER_WORKING, DOWNLOADER_COMPLETED, THUMBS_WORKING e TITLES_WORKING. Tags WORKING usam heartbeat/TTL e expiram para o passo estável anterior.",
    inputSchema: { projeto_id:z.string().min(1), ativar:z.array(z.string()).max(20).optional(), remover:z.array(z.string()).max(20).optional(), owner_id:z.string().optional(), execution_id:z.string().optional(), ttl_segundos:z.number().int().min(30).max(7200).optional(), metadata:z.any().optional() },
  }, async (v) => output(await updateProjectWorkflow(env,{projectId:v.projeto_id,activate:v.ativar,clear:v.remover,ownerId:v.owner_id,executionId:v.execution_id,ttlSeconds:v.ttl_segundos,metadata:v.metadata})));

  server.registerTool("heartbeat_estados_projeto", {
    description: "Renova heartbeat das tags WORKING de um agente no projeto sem bloquear outras frentes/agentes do mesmo projeto.",
    inputSchema: { projeto_id:z.string().min(1), tags:z.array(z.string()).min(1).max(20), owner_id:z.string().min(1), execution_id:z.string().min(1), ttl_segundos:z.number().int().min(30).max(7200).optional() },
  }, async (v) => output(await heartbeatProjectWorkflow(env,{projectId:v.projeto_id,tags:v.tags,ownerId:v.owner_id,executionId:v.execution_id,ttlSeconds:v.ttl_segundos})));

  server.registerTool("concluir_projetos", {
    description: "Conclui um ou vários projetos e bloqueia novas mutações MCP. Só reabrir_projeto_concluido, por comando explícito do usuário, remove o bloqueio.",
    inputSchema: { projeto_ids:z.array(z.string()).min(1).max(200), motivo:z.string().optional() },
  }, async (v) => output(await setProjectLifecycle(env,{projectIds:v.projeto_ids,action:"COMPLETE",reason:v.motivo})));

  server.registerTool("rejeitar_projetos", {
    description: "Rejeita um ou vários projetos, encerra trabalhos ativos e bloqueia novas mutações MCP até reabertura explícita.",
    inputSchema: { projeto_ids:z.array(z.string()).min(1).max(200), motivo:z.string().optional() },
  }, async (v) => output(await setProjectLifecycle(env,{projectIds:v.projeto_ids,action:"REJECT",reason:v.motivo})));

  server.registerTool("excluir_projetos_permanentemente", {
    description: "Exclusão irreversível em lote do projeto e seus artefatos temporários/arquivos/pacotes. Assets globais aprovados da Library são preservados. Exige confirmar=true.",
    inputSchema: { projeto_ids:z.array(z.string()).min(1).max(100), confirmar:z.boolean() },
  }, async (v) => output(await deleteProjectsPermanently(env,v.projeto_ids,v.confirmar)));

  server.registerTool("configurar_dominio_projeto", {
    description: "Atualiza domínio e prioridade operacional de um projeto automático.",
    inputSchema: { projeto_id:z.string().min(1), dominio:z.string().min(1), prioridade_fila:z.number().int().min(1).max(100).optional() },
  }, async ({projeto_id,dominio,prioridade_fila}) => output((await configureAutomaticProject(env,projeto_id,{dominio,prioridade_fila}))||{error:"NOT_FOUND"}));

  server.registerTool("sincronizar_filas_workers", {
    description: "Reconcilia itens de projeto com worker_work_items READY sem duplicar leases/trabalhos ativos.",
    inputSchema: { projeto_id:z.string().optional(), limite_projetos:z.number().int().min(1).max(100).optional() },
  }, async ({projeto_id,limite_projetos}) => {
    if(projeto_id) return output((await reconcileAutomaticProject(env,projeto_id))||{error:"NOT_FOUND"});
    const projects=await listAutomaticProjects(env,limite_projetos||25,null); const results: unknown[]=[];
    for(const project of projects.items){ if(String(project.status)!=="COMPLETED") results.push(await reconcileAutomaticProject(env,String(project.id))); }
    return output({projects:results.length,results});
  });

  server.registerTool("exportar_txt_operacao", {
    description: "Retorna relatório textual compacto da operação; não cria arquivo físico ou segredo.",
    inputSchema: {},
  }, async () => { const [dispatcher,pipeline,risk,latest]=await Promise.all([dispatcherHealth(env),pipelineTelemetry(env),operationalRisk(env),latestOperation(env)]); return output({text:["CORVO LIBRARY V2 — OPERACAO",`Risco: ${risk.level} (${risk.score})`,`Ultima operacao: ${latest?.id||"nenhuma"}`,`Leases expirados: ${dispatcher.expiredLeases}`,`Projetos: ${JSON.stringify(pipeline.projects)}`].join("\n")}); });

  server.registerTool("configurar_projeto_automatico", {
    description: "Configura flags, domínio, prioridade e estado operacional do projeto sem tocar em R2 ou IDs.",
    inputSchema: { projeto_id:z.string().min(1), automatico:z.boolean().optional(), biblioteca_primeiro:z.boolean().optional(), busca_externa:z.boolean().optional(), zip_automatico:z.boolean().optional(), excluir_zip_ao_concluir:z.boolean().optional(), dominio:z.string().optional(), prioridade_fila:z.number().int().min(1).max(100).optional(), status:z.string().optional(), pipeline_status:z.string().optional(), next_action:z.string().nullable().optional() },
  }, async ({projeto_id,...input}) => output((await configureAutomaticProject(env,projeto_id,input))||{error:"NOT_FOUND"}));

  server.registerTool("processar_projeto_automatico", {
    description: "Ativa o projeto e reconcilia sua fila de workers a partir dos itens históricos.",
    inputSchema: { projeto_id:z.string().min(1) },
  }, async ({projeto_id}) => output((await processAutomaticProject(env,projeto_id))||{error:"NOT_FOUND"}));

  server.registerTool("reconciliar_projeto_automatico", {
    description: "Recalcula contagens do projeto e cria apenas worker_work_items faltantes.",
    inputSchema: { projeto_id:z.string().min(1) },
  }, async ({projeto_id}) => output((await reconcileAutomaticProject(env,projeto_id))||{error:"NOT_FOUND"}));

  server.registerTool("validar_consistencia_projeto", {
    description: "Valida links de assets e objetos R2 de um projeto sem alterar estado.",
    inputSchema: { projeto_id:z.string().min(1) },
  }, async ({projeto_id}) => output((await validateProjectConsistency(env,projeto_id))||{error:"NOT_FOUND"}));

  server.registerTool("reabrir_projeto_concluido", {
    description: "Reabre projeto concluído preservando histórico e incrementando state_version.",
    inputSchema: { projeto_id:z.string().min(1), motivo:z.string().optional() },
  }, async ({projeto_id,motivo}) => output((await reopenAutomaticProject(env,projeto_id,motivo))||{error:"NOT_FOUND"}));

  server.registerTool("verificar_disponibilidade_projeto", {
    description: "Verifica existência, estado, versão e leases ativos de um projeto.",
    inputSchema: { projeto_id:z.string().min(1) },
  }, async ({projeto_id}) => output(await projectAvailability(env,projeto_id)));

  server.registerTool("obter_log_projeto", {
    description: "Retorna eventos do projeto em ordem decrescente.",
    inputSchema: { projeto_id:z.string().min(1), limite:z.number().int().min(1).max(1000).optional() },
  }, async ({projeto_id,limite}) => output({items:await projectLog(env,projeto_id,limite||200)}));

  server.registerTool("obter_ultima_operacao", {
    description: "Retorna a operação FAST PUSH/materialização mais recente.",
    inputSchema: { tipo:z.string().optional() },
  }, async ({tipo}) => output((await latestOperation(env,tipo))||{error:"NOT_FOUND"}));

  server.registerTool("obter_performance_mcp", {
    description: "Agrega telemetria histórica da tabela mcp_audit, sem expor segredos.",
    inputSchema: { limite:z.number().int().min(1).max(1000).optional() },
  }, async ({limite}) => output(await mcpPerformance(env,limite||100)));

  server.registerTool("obter_ranking_rotas_fontes", {
    description: "Ranking histórico de fontes/hosts por score, aprovações e falhas.",
    inputSchema: { limite:z.number().int().min(1).max(500).optional() },
  }, async ({limite}) => output({items:await sourceRouteRanking(env,limite||100)}));

  server.registerTool("obter_politica_risco_mcp", {
    description: "Calcula risco operacional atual a partir de circuitos, leases, gaps e falhas recentes.",
    inputSchema: {},
  }, async () => output(await operationalRisk(env)));

  server.registerTool("obter_log_mcp", {
    description: "Retorna registros recentes da auditoria MCP histórica.",
    inputSchema: { limite:z.number().int().min(1).max(1000).optional() },
  }, async ({limite}) => { const value=await mcpPerformance(env,limite||100); return output({items:value.recent}); });


  server.registerTool("obter_workspace_politicas", {
    description: "Workspace operacional de gaps, políticas e eventos históricos, sem mutações.", inputSchema: { projeto_id:z.string().optional() },
  }, async ({projeto_id}) => output(await policyWorkspace(env,projeto_id)));

  server.registerTool("detectar_gap_operacional", {
    description: "Registra ou incrementa um gap operacional deduplicado por assinatura.",
    inputSchema: { categoria:z.string().min(1), severidade:z.string().optional(), projeto_id:z.string().optional(), item_id:z.string().optional(), dominio:z.string().optional(), universo:z.string().optional(), classe_composicao:z.string().optional(), classe_semantica:z.string().optional(), preset:z.string().optional(), fonte:z.string().optional(), host:z.string().optional(), ferramenta:z.string().optional(), worker_type:z.string().optional(), sintoma:z.string().min(1), causa_raiz:z.string().optional(), evidencia:z.unknown().optional() },
  }, async (v) => output(await detectOperationalGap(env,{category:v.categoria,severity:v.severidade,projectId:v.projeto_id,itemId:v.item_id,domain:v.dominio,universe:v.universo,compositionClass:v.classe_composicao,semanticClass:v.classe_semantica,preset:v.preset,source:v.fonte,host:v.host,tool:v.ferramenta,workerType:v.worker_type,symptom:v.sintoma,rootCause:v.causa_raiz,evidence:v.evidencia})));

  server.registerTool("listar_gaps_operacionais", { description:"Lista gaps operacionais com filtros.", inputSchema:{ status:z.string().optional(), severidade:z.string().optional(), categoria:z.string().optional(), projeto_id:z.string().optional(), limite:z.number().int().min(1).max(500).optional() } }, async(v)=>output({items:await listOperationalGaps(env,{status:v.status,severity:v.severidade,category:v.categoria,projectId:v.projeto_id,limit:v.limite})}));
  server.registerTool("obter_gap_operacional", { description:"Obtém um gap operacional por ID.", inputSchema:{ gap_id:z.string().min(1) } }, async({gap_id})=>output((await getOperationalGap(env,gap_id))||{error:"NOT_FOUND"}));

  server.registerTool("criar_politica_operacional", {
    description:"Cria nova política em DRAFT, preservando versionamento e vínculo opcional ao gap.",
    inputSchema:{ policy_key:z.string().optional(), nome:z.string().min(1), descricao:z.string().optional(), categoria:z.string().min(1), scope_level:z.string().optional(), propagation_level:z.number().int().min(1).max(10).optional(), dominio:z.string().optional(), universo:z.string().optional(), work_type:z.string().optional(), classe_composicao:z.string().optional(), classe_semantica:z.string().optional(), preset:z.string().optional(), projeto_id:z.string().optional(), item_id:z.string().optional(), condicao:z.unknown().optional(), acao:z.unknown().optional(), prioridade:z.number().int().min(1).max(100).optional(), confianca:z.number().min(0).max(100).optional(), gap_origem_id:z.string().optional(), notas:z.string().optional() },
  }, async(v)=>output(await createOperationalPolicy(env,{policyKey:v.policy_key,name:v.nome,description:v.descricao,category:v.categoria,scopeLevel:v.scope_level,propagationLevel:v.propagation_level,domain:v.dominio,universe:v.universo,workType:v.work_type,compositionClass:v.classe_composicao,semanticClass:v.classe_semantica,preset:v.preset,projectId:v.projeto_id,itemId:v.item_id,condition:v.condicao,action:v.acao,priority:v.prioridade,confidence:v.confianca,sourceGapId:v.gap_origem_id,notes:v.notas})));

  server.registerTool("definir_politica_supervisor_livre", {
    description:"Autoria livre de política pelo Supervisor MCP. Aceita condição/ação arbitrárias, qualquer escopo e pode ativar imediatamente; o frontend não limita a criatividade operacional do Supervisor.",
    inputSchema:{ policy_key:z.string().optional(), nome:z.string().min(1), descricao:z.string().optional(), categoria:z.string().default("SUPERVISOR"), scope_level:z.string().optional(), propagation_level:z.number().int().min(1).max(10).optional(), dominio:z.string().optional(), universo:z.string().optional(), work_type:z.string().optional(), classe_composicao:z.string().optional(), classe_semantica:z.string().optional(), preset:z.string().optional(), projeto_id:z.string().optional(), item_id:z.string().optional(), condicao:z.unknown().optional(), acao:z.unknown().optional(), prioridade:z.number().int().min(1).max(100).optional(), confianca:z.number().min(0).max(100).optional(), notas:z.string().optional(), ativar:z.boolean().optional() },
  }, async(v)=>{ const created=await createOperationalPolicy(env,{policyKey:v.policy_key,name:v.nome,description:v.descricao,category:v.categoria,scopeLevel:v.scope_level||"GLOBAL",propagationLevel:v.propagation_level||10,domain:v.dominio,universe:v.universo,workType:v.work_type,compositionClass:v.classe_composicao,semanticClass:v.classe_semantica,preset:v.preset,projectId:v.projeto_id,itemId:v.item_id,condition:v.condicao,action:v.acao,priority:v.prioridade||100,confidence:v.confianca??100,notes:v.notas}); if(v.ativar!==false && created?.id)return output(await setPolicyStatus(env,String(created.id),"ACTIVE","SUPERVISOR_FREE_ACTIVATE")); return output(created); });

  server.registerTool("editar_politica_operacional", { description:"Edita por nova versão imutável e marca a versão anterior como SUPERSEDED.", inputSchema:{ politica_id:z.string().min(1), nome:z.string().optional(), descricao:z.string().optional(), condicao:z.unknown().optional(), acao:z.unknown().optional(), prioridade:z.number().int().min(1).max(100).optional(), confianca:z.number().min(0).max(100).optional(), notas:z.string().optional() } }, async({politica_id,...v})=>output((await editOperationalPolicy(env,politica_id,{name:v.nome,description:v.descricao,condition:v.condicao,action:v.acao,priority:v.prioridade,confidence:v.confianca,notes:v.notas}))||{error:"NOT_FOUND"}));
  server.registerTool("testar_politica_operacional", { description:"Dry-run: estima gaps abertos correspondentes; não executa a ação da política.", inputSchema:{ politica_id:z.string().min(1) } }, async({politica_id})=>output((await testPolicy(env,politica_id))||{error:"NOT_FOUND"}));
  server.registerTool("ativar_politica_operacional", { description:"Ativa uma política explicitamente.", inputSchema:{ politica_id:z.string().min(1) } }, async({politica_id})=>output((await setPolicyStatus(env,politica_id,"ACTIVE","ACTIVATE"))||{error:"NOT_FOUND"}));
  server.registerTool("promover_politica_operacional", { description:"Promove uma política para ACTIVE após decisão explícita.", inputSchema:{ politica_id:z.string().min(1) } }, async({politica_id})=>output((await setPolicyStatus(env,politica_id,"ACTIVE","PROMOTE"))||{error:"NOT_FOUND"}));
  server.registerTool("suspender_politica_operacional", { description:"Suspende uma política sem apagá-la.", inputSchema:{ politica_id:z.string().min(1) } }, async({politica_id})=>output((await setPolicyStatus(env,politica_id,"SUSPENDED","SUSPEND"))||{error:"NOT_FOUND"}));
  server.registerTool("rollback_politica_operacional", { description:"Faz rollback para a versão anterior preservando o histórico.", inputSchema:{ politica_id:z.string().min(1) } }, async({politica_id})=>output(await rollbackPolicy(env,politica_id)));
  server.registerTool("listar_politicas_operacionais", { description:"Lista políticas operacionais por status/categoria/projeto/chave.", inputSchema:{ status:z.string().optional(), categoria:z.string().optional(), projeto_id:z.string().optional(), policy_key:z.string().optional(), limite:z.number().int().min(1).max(500).optional() } }, async(v)=>output({items:await listOperationalPolicies(env,{status:v.status,category:v.categoria,projectId:v.projeto_id,policyKey:v.policy_key,limit:v.limite})}));
  server.registerTool("obter_politicas_aplicadas", { description:"Lista eventos de políticas já aplicadas/alteradas.", inputSchema:{ projeto_id:z.string().optional(), limite:z.number().int().min(1).max(500).optional() } }, async({projeto_id,limite})=>output({items:await appliedPolicies(env,projeto_id,limite||200)}));
  server.registerTool("vincular_gap_politica", { description:"Vincula um gap a uma política existente.", inputSchema:{ gap_id:z.string().min(1), politica_id:z.string().min(1) } }, async({gap_id,politica_id})=>output((await linkGapPolicy(env,gap_id,politica_id))||{error:"NOT_FOUND"}));
  server.registerTool("obter_telemetria_politicas", { description:"Agrega uso, sucesso/falha e eventos de políticas.", inputSchema:{} }, async()=>output(await policyTelemetry(env)));
  server.registerTool("resolver_gap_e_aprender", { description:"Resolve um gap e cria uma política DRAFT quando ainda não houver uma vinculada.", inputSchema:{ gap_id:z.string().min(1), nome_politica:z.string().optional(), acao:z.unknown().optional(), condicao:z.unknown().optional(), confianca:z.number().min(0).max(100).optional() } }, async(v)=>output((await resolveGapAndLearn(env,v.gap_id,{policyName:v.nome_politica,action:v.acao,condition:v.condicao,confidence:v.confianca}))||{error:"NOT_FOUND"}));

  server.registerTool("obter_status_supervisor_ia", { description:"Estado do Supervisor V2 e suas configurações operacionais seguras.", inputSchema:{} }, async()=>output(await supervisorStatus(env)));
  server.registerTool("configurar_supervisor_mcp", { description:"Altera apenas chaves supervisor_* explicitamente permitidas; nunca aceita segredos/credenciais.", inputSchema:{ supervisor_mcp_enabled:z.boolean().optional(), supervisor_lease_ttl_minutes:z.number().int().min(1).max(120).optional(), supervisor_watchdog_interval_minutes:z.number().int().min(1).max(120).optional(), supervisor_renew_on_activity:z.boolean().optional(), supervisor_auto_mark_abandoned:z.boolean().optional(), supervisor_auto_ready_for_resume:z.boolean().optional(), supervisor_reconcile_before_resume:z.boolean().optional(), supervisor_require_execution_id_for_writes:z.boolean().optional(), supervisor_plan_max_parallelism:z.number().int().min(1).max(100).optional(), supervisor_plan_max_wip:z.number().int().min(1).max(1000).optional(), supervisor_plan_packet_size:z.number().int().min(1).max(200).optional(), supervisor_plan_candidate_buffer_min:z.number().int().min(0).max(20).optional(), supervisor_plan_candidate_buffer_target:z.number().int().min(0).max(50).optional(), supervisor_default_source_profile:z.string().optional() } }, async(v)=>output(await configureSupervisor(env,v)));
  server.registerTool("assumir_proximo_trabalho_supervisor", { description:"Obtém lease atômico de um projeto disponível para o Supervisor.", inputSchema:{ worker_id:z.string().optional(), projeto_id:z.string().optional(), lease_minutos:z.number().int().min(1).max(120).optional() } }, async(v)=>output(await claimNextSupervisorWork(env,{workerId:v.worker_id,projectId:v.projeto_id,leaseMinutes:v.lease_minutos})));
  server.registerTool("backfill_projetos_legados", { description:"DESATIVADO: projetos históricos foram removidos por decisão operacional; a V2 não tenta reconstruir estado visual sem funcionalidade.", inputSchema:{ limite:z.number().int().min(1).max(500).optional() } }, async()=>output({error:"LEGACY_PROJECT_BACKFILL_DISABLED",status:410,detail:"Crie projetos novos na V2."}));
  server.registerTool("heartbeat_supervisor", { description:"Renova o lease do Supervisor somente para o projeto/execution_id atual. Um agente não pode renovar a execução de outro.", inputSchema:{ projeto_id:z.string().min(1), execution_id:z.string().min(1), worker_id:z.string().optional(), lease_minutos:z.number().int().min(1).max(120).optional() } }, async(v)=>output(await heartbeatSupervisor(env,{projectId:v.projeto_id,executionId:v.execution_id,ownerId:v.worker_id,leaseMinutes:v.lease_minutos})));
  server.registerTool("executar_watchdog_supervisor", { description:"Marca execuções Supervisor com lease expirado como abandonadas.", inputSchema:{} }, async()=>output(await supervisorWatchdog(env)));
  server.registerTool("obter_telemetria_leases_supervisor", { description:"Telemetria de leases do Supervisor.", inputSchema:{} }, async()=>output(await supervisorLeaseTelemetry(env)));
  server.registerTool("executar_dispatcher_workers", { description:"Reconcilia filas dos projetos ativos e retorna saúde do dispatcher.", inputSchema:{ limite_projetos:z.number().int().min(1).max(100).optional() } }, async({limite_projetos})=>{const projects=await listAutomaticProjects(env,limite_projetos||25,null);let reconciled=0;for(const p of projects.items){if(!["COMPLETED","CANCELLED"].includes(String(p.status))){await reconcileAutomaticProject(env,String(p.id));reconciled++;}}return output({reconciled,health:await dispatcherHealth(env)});});

  server.registerTool("obter_estado_supervisor", { description:"Estado consolidado do Supervisor; pode ser filtrado por projeto no painel.", inputSchema:{} }, async()=>output(await supervisorStatus(env)));
  server.registerTool("obter_painel_supervisor", { description:"Painel Supervisor com leases, decisões e candidatas pendentes.", inputSchema:{ projeto_id:z.string().optional() } }, async({projeto_id})=>output(await supervisorPanel(env,projeto_id)));
  server.registerTool("obter_candidatas_qa_visual", { description:"Candidatas do Supervisor com preview temporário assinado pelo Worker/R2.", inputSchema:{ projeto_id:z.string().optional(), status:z.string().optional(), limite:z.number().int().min(1).max(200).optional() } }, async(v)=>output({items:await listSupervisorCandidatesWithLinks(request,env,{projectId:v.projeto_id,status:v.status||"PARA_ANALISE",limit:v.limite})}));
  server.registerTool("listar_decisoes_supervisor", { description:"Lista a fila histórica de decisões do Supervisor.", inputSchema:{ projeto_id:z.string().optional(), estado:z.string().optional(), tipo:z.string().optional(), limite:z.number().int().min(1).max(500).optional() } }, async(v)=>output({items:await listSupervisorDecisions(env,{projectId:v.projeto_id,state:v.estado,type:v.tipo,limit:v.limite})}));
  server.registerTool("resolver_decisao_supervisor", { description:"Resolve uma decisão pendente registrando decisão e observação.", inputSchema:{ decisao_id:z.string().min(1), decisao:z.string().min(1), observacao:z.string().optional() } }, async(v)=>output((await resolveSupervisorDecision(env,v.decisao_id,{decision:v.decisao,observation:v.observacao}))||{error:"NOT_FOUND_OR_RESOLVED"}));
  server.registerTool("continuar_processamento", { description:"Retoma processamento de projeto.", inputSchema:{ projeto_id:z.string().min(1) } }, async({projeto_id})=>output((await setProjectProcessingState(env,projeto_id,"CONTINUE"))||{error:"NOT_FOUND"}));
  server.registerTool("pausar_processamento", { description:"Pausa projeto sem apagar fila/histórico.", inputSchema:{ projeto_id:z.string().min(1) } }, async({projeto_id})=>output((await setProjectProcessingState(env,projeto_id,"PAUSE"))||{error:"NOT_FOUND"}));
  server.registerTool("cancelar_processamento", { description:"Cancela projeto preservando dados/histórico.", inputSchema:{ projeto_id:z.string().min(1) } }, async({projeto_id})=>output((await setProjectProcessingState(env,projeto_id,"CANCEL"))||{error:"NOT_FOUND"}));
  server.registerTool("pausar_item", { description:"Pausa item individual.", inputSchema:{ item_id:z.string().min(1) } }, async({item_id})=>output((await setItemProcessingState(env,item_id,"PAUSE"))||{error:"NOT_FOUND"}));
  server.registerTool("retomar_item", { description:"Retoma item individual.", inputSchema:{ item_id:z.string().min(1) } }, async({item_id})=>output((await setItemProcessingState(env,item_id,"RESUME"))||{error:"NOT_FOUND"}));
  server.registerTool("cancelar_item", { description:"Cancela item individual preservando histórico.", inputSchema:{ item_id:z.string().min(1) } }, async({item_id})=>output((await setItemProcessingState(env,item_id,"CANCEL"))||{error:"NOT_FOUND"}));
  server.registerTool("congelar_item", { description:"Congela item individual para impedir processamento automático.", inputSchema:{ item_id:z.string().min(1) } }, async({item_id})=>output((await setItemProcessingState(env,item_id,"FREEZE"))||{error:"NOT_FOUND"}));
  server.registerTool("aprovar_candidata", { description:"Aprova candidata histórica do Supervisor sem alterar outras candidatas.", inputSchema:{ candidata_id:z.string().min(1), observacao:z.string().optional() } }, async(v)=>output((await decideSupervisorCandidate(env,v.candidata_id,"APPROVED",v.observacao))||{error:"NOT_FOUND"}));
  server.registerTool("rejeitar_candidata", { description:"Rejeita candidata histórica do Supervisor preservando materialização para auditoria.", inputSchema:{ candidata_id:z.string().min(1), motivo:z.string().optional() } }, async(v)=>output((await decideSupervisorCandidate(env,v.candidata_id,"REJECTED",v.motivo))||{error:"NOT_FOUND"}));
  server.registerTool("relinkar_item", { description:"Relinka item a asset existente, sem alterar o asset/r2_key.", inputSchema:{ item_id:z.string().min(1), asset_id:z.string().min(1) } }, async(v)=>output(await relinkItem(env,v.item_id,v.asset_id)));
  server.registerTool("relinkar_itens_lote", { description:"Relinka vários itens em lote.", inputSchema:{ pares:z.array(z.object({item_id:z.string().min(1),asset_id:z.string().min(1)})).max(200) } }, async({pares})=>output(await relinkItems(env,pares.map((p: {item_id:string;asset_id:string})=>({itemId:p.item_id,assetId:p.asset_id})))));
  server.registerTool("alterar_referencia", { description:"Atualiza referência semântica de busca do item.", inputSchema:{ item_id:z.string().min(1), referencia:z.string().min(1) } }, async(v)=>output((await updateItemSearch(env,v.item_id,{reference:v.referencia}))||{error:"NOT_FOUND"}));
  server.registerTool("alterar_query", { description:"Atualiza plano/query de busca do item.", inputSchema:{ item_id:z.string().min(1), query:z.string().min(1) } }, async(v)=>output((await updateItemSearch(env,v.item_id,{query:v.query}))||{error:"NOT_FOUND"}));
  server.registerTool("trocar_fonte", { description:"Troca a fonte preferida do item sem materializar automaticamente.", inputSchema:{ item_id:z.string().min(1), fonte:z.string().min(1) } }, async(v)=>output((await updateItemSearch(env,v.item_id,{source:v.fonte}))||{error:"NOT_FOUND"}));
  server.registerTool("bloquear_host", { description:"Abre manualmente o circuit breaker de um host.", inputSchema:{ host:z.string().min(1), motivo:z.string().optional() } }, async(v)=>output(await setHostBlocked(env,v.host,true,v.motivo)));
  server.registerTool("desbloquear_host", { description:"Fecha manualmente o circuit breaker de um host.", inputSchema:{ host:z.string().min(1), motivo:z.string().optional() } }, async(v)=>output(await setHostBlocked(env,v.host,false,v.motivo)));
  server.registerTool("alterar_timeout", { description:"Altera timeout global de coleta permitido pela V2.", inputSchema:{ timeout_ms:z.number().int().min(500).max(120000) } }, async(v)=>output(await updateCollectionSettings(env,{timeoutMs:v.timeout_ms})));
  server.registerTool("alterar_configuracao_coleta", { description:"Atualiza configuração operacional de coleta, sem credenciais.", inputSchema:{ timeout_ms:z.number().int().min(500).max(120000).optional(), paralelismo:z.number().int().min(1).max(100).optional() } }, async(v)=>output(await updateCollectionSettings(env,{timeoutMs:v.timeout_ms,parallelism:v.paralelismo})));
  server.registerTool("alterar_prioridade_fonte", { description:"Atualiza prioridade de uma fonte cadastrada.", inputSchema:{ fonte_id:z.string().min(1), prioridade:z.number().int().min(1).max(100) } }, async(v)=>output((await updateCollectionSource(env,v.fonte_id,{priority:v.prioridade}))||{error:"NOT_FOUND"}));
  server.registerTool("atualizar_fonte_coleta", { description:"Atualiza campos operacionais permitidos da fonte de coleta.", inputSchema:{ fonte_id:z.string().min(1), prioridade:z.number().int().min(1).max(100).optional(), timeout_ms:z.number().int().min(500).max(120000).optional(), ativa:z.boolean().optional(), nota:z.string().optional() } }, async(v)=>output((await updateCollectionSource(env,v.fonte_id,{priority:v.prioridade,timeoutMs:v.timeout_ms,active:v.ativa,note:v.nota}))||{error:"NOT_FOUND"}));
  server.registerTool("alterar_limites_coleta", { description:"Atualiza limites dos perfis ativos de coleta.", inputSchema:{ max_urls_por_termo:z.number().int().min(1).max(1000).optional(), max_fontes_por_termo:z.number().int().min(1).max(200).optional(), max_rodadas:z.number().int().min(1).max(50).optional() } }, async(v)=>output(await updateCollectionSettings(env,{maxUrlsPerTerm:v.max_urls_por_termo,maxSourcesPerTerm:v.max_fontes_por_termo,maxRounds:v.max_rodadas})));
  server.registerTool("salvar_perfil_coleta", { description:"Cria perfil de coleta operacional sem armazenar API keys.", inputSchema:{ nome:z.string().min(1), tipo:z.string().optional(), universos:z.array(z.string()).optional(), classe_composicao:z.string().optional(), classe_semantica:z.string().optional(), hosts_preferidos:z.array(z.string()).optional(), hosts_bloqueados:z.array(z.string()).optional(), fontes_preferidas:z.array(z.string()).optional(), query_template:z.string().optional(), termos_negativos:z.array(z.string()).optional(), timeout_ms:z.number().int().min(500).max(120000).optional(), max_falhas:z.number().int().min(1).max(100).optional(), max_urls_por_termo:z.number().int().min(1).max(1000).optional(), max_fontes_por_termo:z.number().int().min(1).max(200).optional(), max_rodadas:z.number().int().min(1).max(50).optional(), formatos:z.array(z.string()).optional(), prioridade:z.number().int().min(1).max(100).optional(), dominio:z.string().optional(), notas:z.string().optional() } }, async(v)=>output(await saveSourceProfile(env,{name:v.nome,type:v.tipo,universes:v.universos,compositionClass:v.classe_composicao,semanticClass:v.classe_semantica,preferredHosts:v.hosts_preferidos,blockedHosts:v.hosts_bloqueados,preferredSources:v.fontes_preferidas,queryTemplate:v.query_template,negativeTerms:v.termos_negativos,timeoutMs:v.timeout_ms,maxConsecutiveFailures:v.max_falhas,maxUrlsPerTerm:v.max_urls_por_termo,maxSourcesPerTerm:v.max_fontes_por_termo,maxRounds:v.max_rodadas,acceptedFormats:v.formatos,priority:v.prioridade,domain:v.dominio,notes:v.notas})));
  server.registerTool("atualizar_perfil_coleta", { description:"Atualiza perfil de coleta existente.", inputSchema:{ perfil_id:z.string().min(1), nome:z.string().optional(), tipo:z.string().optional(), universos:z.array(z.string()).optional(), hosts_preferidos:z.array(z.string()).optional(), hosts_bloqueados:z.array(z.string()).optional(), fontes_preferidas:z.array(z.string()).optional(), query_template:z.string().optional(), timeout_ms:z.number().int().min(500).max(120000).optional(), prioridade:z.number().int().min(1).max(100).optional(), dominio:z.string().optional(), notas:z.string().optional() } }, async({perfil_id,...v})=>output((await updateSourceProfile(env,perfil_id,{name:v.nome,type:v.tipo,universes:v.universos,preferredHosts:v.hosts_preferidos,blockedHosts:v.hosts_bloqueados,preferredSources:v.fontes_preferidas,queryTemplate:v.query_template,timeoutMs:v.timeout_ms,priority:v.prioridade,domain:v.dominio,notes:v.notas}))||{error:"NOT_FOUND"}));
  server.registerTool("listar_perfis_coleta", { description:"Lista perfis de coleta.", inputSchema:{ limite:z.number().int().min(1).max(500).optional() } }, async({limite})=>output({items:await listSourceProfiles(env,limite||100)}));
  server.registerTool("ativar_perfil_coleta", { description:"Ativa perfil de coleta.", inputSchema:{ perfil_id:z.string().min(1) } }, async({perfil_id})=>output((await setSourceProfileStatus(env,perfil_id,"ATIVO"))||{error:"NOT_FOUND"}));
  server.registerTool("desativar_perfil_coleta", { description:"Desativa perfil de coleta.", inputSchema:{ perfil_id:z.string().min(1) } }, async({perfil_id})=>output((await setSourceProfileStatus(env,perfil_id,"INATIVO"))||{error:"NOT_FOUND"}));
  server.registerTool("salvar_como_padrao", { description:"Define perfil de coleta padrão, sem copiar credenciais.", inputSchema:{ perfil_id:z.string().min(1) } }, async({perfil_id})=>output((await setDefaultSourceProfile(env,perfil_id))||{error:"NOT_FOUND"}));
  server.registerTool("obter_resumo_noturno", { description:"Resumo operacional compacto para execução/monitoramento noturno.", inputSchema:{} }, async()=>output(await nightlySummary(env)));

  server.registerTool("listar_configuracoes", { description:"Lista somente configurações operacionais não secretas. Credenciais/bindings nunca são retornados.", inputSchema:{} }, async()=>output({items:await listSafeSettings(env),bindings:await bindingStatus(env)}));
  server.registerTool("atualizar_configuracao", { description:"Atualiza apenas chave operacional permitida; rejeita secrets/tokens/credenciais e configuração Cloudflare.", inputSchema:{ chave:z.string().min(1), valor:z.union([z.string(),z.number(),z.boolean()]) } }, async(v)=>output(await updateSafeSetting(env,v.chave,v.valor)));

  // --- V2 0.7: control plane, production delivery, plans and automatic collection ---
  server.registerTool("obter_modo_entrega_chat", { description:"Retorna a política de entrega da V2. Binários permanecem no R2 e o MCP devolve links temporários, nunca arquivos em chat.", inputSchema:{} }, async()=>output({mode:"LINKS_ONLY",chat_file_delivery:false,direct_to_pc:true}));
  server.registerTool("configurar_modo_entrega_chat", { description:"Compatibilidade histórica. Na V2 o modo seguro LINKS_ONLY é fixo e não pode habilitar transporte de binários pelo MCP.", inputSchema:{ modo:z.string().optional() } }, async()=>output({mode:"LINKS_ONLY",changed:false,reason:"V2_SECURITY_POLICY"}));
  server.registerTool("fast_visual_packet", { description:"Retorna candidatas materializadas com previews temporários para decisão visual rápida.", inputSchema:{ status:z.string().optional(), limite:z.number().int().min(1).max(100).optional() } }, async(v)=>output({items:await listCandidates(requestFor(request,`/candidates?status=${encodeURIComponent(v.status||"MATERIALIZED")}&limit=${v.limite||50}`),env)}));
  server.registerTool("exportar_pacote_qa_json", { description:"Exporta o pacote de QA como JSON lógico com metadados e links; não materializa arquivo no chat.", inputSchema:{ status:z.string().optional(), limite:z.number().int().min(1).max(200).optional() } }, async(v)=>output({format:"JSON",items:await listCandidates(requestFor(request,`/candidates?status=${encodeURIComponent(v.status||"MATERIALIZED")}&limit=${v.limite||100}`),env)}));
  server.registerTool("gerar_grid_candidatas", { description:"Compatibilidade visual: devolve candidatos e seus links temporários para que o cliente componha a grade sem gerar imagem intermediária.", inputSchema:{ limite:z.number().int().min(1).max(100).optional() } }, async(v)=>output({render:"CLIENT_GRID",items:await listCandidates(requestFor(request,`/candidates?status=MATERIALIZED&limit=${v.limite||40}`),env)}));

  server.registerTool("FAST_APPROVE_PROJECT_ITEMS", { description:"ACK assíncrono: aprova pares item/candidata e congela os itens no Data Plane. Não espera o lote concluir.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional(), aprovacoes:z.array(z.object({item_id:z.string().optional(),target_file:z.string().optional(),candidata_id:z.string().min(1),observacao:z.string().optional()})).min(1).max(100) } }, async(v)=>output(await enqueueFastApproveProjectItems(env,{projectId:v.projeto_id,operationId:v.operation_id,approvals:v.aprovacoes.map((a: {item_id?:string;target_file?:string;candidata_id:string;observacao?:string})=>({itemId:a.item_id,targetFile:a.target_file,candidateId:a.candidata_id,note:a.observacao}))})));
  server.registerTool("aplicar_decisoes_supervisor_lote", { description:"ACK assíncrono para decisões do Supervisor sobre vários itens.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional(), decisoes:z.array(z.object({item_id:z.string().min(1),status:z.string().min(1),observacao:z.string().optional()})).min(1).max(200) } }, async(v)=>output(await enqueueSupervisorDecisions(env,{projectId:v.projeto_id,operationId:v.operation_id,decisions:v.decisoes.map((d: {item_id:string;status:string;observacao?:string})=>({itemId:d.item_id,status:d.status,observation:d.observacao}))})));
  server.registerTool("aprovar_itens_lote", { description:"Aprova itens que tenham exatamente uma candidata ativa; ambiguidades são devolvidas sem decisão automática.", inputSchema:{ projeto_id:z.string().min(1), item_ids:z.array(z.string()).min(1).max(100), observacao:z.string().optional(), operation_id:z.string().optional() } }, async(v)=>output(await enqueueApprovalsByItems(env,{projectId:v.projeto_id,itemIds:v.item_ids,reason:v.observacao,operationId:v.operation_id})));
  server.registerTool("aprovar_target_files_lote", { description:"Aprova por target_file quando houver uma única candidata ativa.", inputSchema:{ projeto_id:z.string().min(1), target_files:z.array(z.string()).min(1).max(100), observacao:z.string().optional(), operation_id:z.string().optional() } }, async(v)=>output(await enqueueApprovalsByItems(env,{projectId:v.projeto_id,targetFiles:v.target_files,reason:v.observacao,operationId:v.operation_id})));
  server.registerTool("relink_itens_lote", { description:"Coloca itens em RELINK_REQUIRED de forma assíncrona.", inputSchema:{ projeto_id:z.string().min(1), item_ids:z.array(z.string()).max(200).optional(), target_files:z.array(z.string()).max(200).optional(), motivo:z.string().optional(), operation_id:z.string().optional() } }, async(v)=>output(await relinkProjectItems(env,{projectId:v.projeto_id,itemIds:v.item_ids,targetFiles:v.target_files,reason:v.motivo,operationId:v.operation_id})));
  server.registerTool("rejeitar_itens_lote", { description:"Rejeita itens em lote e os encaminha para relink sem apagar mídia histórica.", inputSchema:{ projeto_id:z.string().min(1), item_ids:z.array(z.string()).max(200).optional(), target_files:z.array(z.string()).max(200).optional(), motivo:z.string().optional(), operation_id:z.string().optional() } }, async(v)=>output(await rejectProjectItems(env,{projectId:v.projeto_id,itemIds:v.item_ids,targetFiles:v.target_files,reason:v.motivo,operationId:v.operation_id})));

  server.registerTool("importar_midia_por_url", { description:"Importa mídia por URL usando o mesmo FAST PUSH assíncrono da V2.", inputSchema:{ urls:z.array(z.string().url()).min(1).max(200), projeto_id:z.string().optional(), universo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).optional() } }, async(v)=>output(await enqueueFastPushItems(env,v.urls.map((url: string)=>({url,projectId:v.projeto_id,universe:v.universo,subject:v.sujeito,tags:v.tags})),{type:"IMPORT_MEDIA_URL"})));
  server.registerTool("materializar_candidata", { description:"Reagenda uma candidata FAST PUSH com falha/retry sem o MCP baixar o arquivo.", inputSchema:{ candidata_id:z.string().min(1) } }, async(v)=>output(await retryIngestCandidate(v.candidata_id,env)));
  server.registerTool("descartar_candidata", { description:"Descarta candidata FAST PUSH e remove apenas o objeto temporário correspondente.", inputSchema:{ candidata_id:z.string().min(1) } }, async(v)=>output(await rejectCandidate(v.candidata_id,env)));

  server.registerTool("obter_thumbs_links", { description:"Lista thumbs do projeto com links temporários do R2.", inputSchema:{ projeto_id:z.string().min(1), limite:z.number().int().min(1).max(100).optional() } }, async(v)=>output(await projectThumbLinks(request,env,v.projeto_id,v.limite||50)));
  server.registerTool("fast_decidir_thumbs_lote", { description:"Decide thumbs em lote (APPROVE, REJECT ou SELECT).", inputSchema:{ projeto_id:z.string().min(1), decisoes:z.array(z.object({thumb_id:z.string().min(1),acao:z.string().min(1),motivo:z.string().optional()})).max(100) } }, async(v)=>output(await decideProjectThumbs(env,v.projeto_id,v.decisoes.map((d: {thumb_id:string;acao:string;motivo?:string})=>({mediaId:d.thumb_id,action:d.acao,reason:d.motivo})) )));
  server.registerTool("fast_push_titulos", { description:"Registra candidatos de título no projeto sem duplicar infraestrutura de produção.", inputSchema:{ projeto_id:z.string().min(1), titulos:z.array(z.union([z.string(),z.object({texto:z.string().min(1),origem:z.string().optional()})])).min(1).max(100) } }, async(v)=>output(await pushProjectTitles(env,v.projeto_id,v.titulos.map((t: string|{texto:string;origem?:string})=>typeof t==="string"?{text:t}:{text:t.texto,agentOrigin:t.origem}))));
  server.registerTool("listar_pacote_producao_projeto", { description:"Retorna itens, arquivos, thumbs, títulos e pacotes do projeto.", inputSchema:{ projeto_id:z.string().min(1) } }, async(v)=>output((await projectProductionPackage(request,env,v.projeto_id))||{error:"NOT_FOUND"}));
  server.registerTool("decidir_thumbs_projeto", { description:"Alias completo para decisão de thumbs do projeto.", inputSchema:{ projeto_id:z.string().min(1), decisoes:z.array(z.object({thumb_id:z.string().min(1),acao:z.string().min(1),motivo:z.string().optional()})).max(100) } }, async(v)=>output(await decideProjectThumbs(env,v.projeto_id,v.decisoes.map((d: {thumb_id:string;acao:string;motivo?:string})=>({mediaId:d.thumb_id,action:d.acao,reason:d.motivo})))));
  server.registerTool("decidir_titulos_projeto", { description:"Aprova, rejeita ou seleciona títulos de produção.", inputSchema:{ projeto_id:z.string().min(1), decisoes:z.array(z.object({titulo_id:z.string().min(1),acao:z.string().min(1)})).max(100) } }, async(v)=>output(await decideProjectTitles(env,v.projeto_id,v.decisoes.map((d: {titulo_id:string;acao:string})=>({titleId:d.titulo_id,action:d.acao})))));
  server.registerTool("gerar_pacote_final", { description:"ACK assíncrono para gerar ZIP final diretamente no R2.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional() } }, async(v)=>output(await queueFinalPackage(env,{projectId:v.projeto_id,operationId:v.operation_id,type:"FULL_PROJECT_ZIP"})));
  server.registerTool("exportar_projeto_completo_zip", { description:"Alias de gerar_pacote_final; o ZIP permanece no R2 e depois é baixado por link temporário.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional() } }, async(v)=>output(await queueFinalPackage(env,{projectId:v.projeto_id,operationId:v.operation_id,type:"FULL_PROJECT_ZIP"})));
  server.registerTool("gerar_zip", { description:"Compatibilidade histórica: enfileira geração do ZIP final do projeto.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional() } }, async(v)=>output(await queueFinalPackage(env,{projectId:v.projeto_id,operationId:v.operation_id,type:"FULL_PROJECT_ZIP"})));
  server.registerTool("regenerar_zip_projeto", { description:"Gera nova revisão do pacote ZIP sem apagar versões anteriores no R2.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional() } }, async(v)=>output(await queueFinalPackage(env,{projectId:v.projeto_id,operationId:v.operation_id,type:"FULL_PROJECT_ZIP"})));
  server.registerTool("listar_pacotes_prontos_para_download", { description:"Lista pacotes READY_FOR_DOWNLOAD armazenados no R2.", inputSchema:{ projeto_id:z.string().optional(), limite:z.number().int().min(1).max(200).optional() } }, async(v)=>output(await listReadyPackages(env,{projectId:v.projeto_id,limit:v.limite||100})));
  server.registerTool("obter_link_download_pacote", { description:"Gera link temporário direto ao R2/Worker para download no computador.", inputSchema:{ pacote_id:z.string().min(1), validade_minutos:z.number().int().min(1).max(60).optional() } }, async(v)=>output(await getPackageLink(request,env,v.pacote_id,v.validade_minutos||30)));
  server.registerTool("confirmar_download_pacote", { description:"Registra confirmação do download sem apagar automaticamente o pacote.", inputSchema:{ pacote_id:z.string().min(1), maquina:z.string().optional(), sha256:z.string().optional() } }, async(v)=>output(await confirmPackageDownload(env,v.pacote_id,{machineName:v.maquina,sha256:v.sha256})));

  server.registerTool("supervisor_exchange", { description:"Hot path V2: aplica decisões anteriores, cria plano/branches e devolve ACK + work packet sem esperar downloads.", inputSchema:{ projeto_id:z.string().min(1), execution_id:z.string().optional(), operation_id:z.string().optional(), intent:z.string().optional(), decisions:z.array(z.object({item_id:z.string().min(1),status:z.string().min(1),observacao:z.string().optional()})).max(50).optional(), commands:z.array(z.unknown()).max(50).optional(), scope:z.unknown().optional(), policies:z.record(z.string(),z.unknown()).optional(), max_parallelism:z.number().int().min(1).max(50).optional(), packet_limit:z.number().int().min(1).max(50).optional() } }, async(v)=>output(await supervisorExchange(env,{projectId:v.projeto_id,executionId:v.execution_id,operationId:v.operation_id,intent:v.intent,decisions:v.decisions?.map((d: {item_id:string;status:string;observacao?:string})=>({itemId:d.item_id,status:d.status,observation:d.observacao})),commands:v.commands,scope:v.scope,policies:v.policies,maxParallelism:v.max_parallelism,packetLimit:v.packet_limit})));
  server.registerTool("executar_ate_divergencia", { description:"Cria plano EXECUTE_UNTIL_DIVERGENCE para o projeto e devolve pacote de trabalho.", inputSchema:{ projeto_id:z.string().min(1), operation_id:z.string().optional(), max_parallelism:z.number().int().min(1).max(50).optional(), packet_limit:z.number().int().min(1).max(50).optional() } }, async(v)=>output(await executeUntilDivergence(env,{projectId:v.projeto_id,operationId:v.operation_id,maxParallelism:v.max_parallelism,packetLimit:v.packet_limit})));
  server.registerTool("obter_work_packet", { description:"Obtém branches prontos/exceções do plano sem alterar leases.", inputSchema:{ plano_id:z.string().min(1), limite:z.number().int().min(1).max(50).optional() } }, async(v)=>output((await getWorkPacket(env,v.plano_id,v.limite||20))||{error:"NOT_FOUND"}));
  server.registerTool("obter_status_plano", { description:"Resumo de status e contagem de branches por plano.", inputSchema:{ plano_id:z.string().min(1) } }, async(v)=>output((await getPlanStatus(env,v.plano_id))||{error:"NOT_FOUND"}));
  server.registerTool("obter_detalhes_plano", { description:"Retorna plano e todas as branches para diagnóstico.", inputSchema:{ plano_id:z.string().min(1) } }, async(v)=>output((await getPlanDetails(env,v.plano_id))||{error:"NOT_FOUND"}));
  server.registerTool("obter_excecoes_plano", { description:"Lista branches divergentes, bloqueadas ou com falha.", inputSchema:{ plano_id:z.string().min(1), limite:z.number().int().min(1).max(200).optional() } }, async(v)=>output(await getPlanExceptions(env,v.plano_id,v.limite||100)));
  server.registerTool("executar_tick_planos", { description:"Reconcilia planos RUNNING e encerra os que não possuem mais branches pendentes.", inputSchema:{ plano_id:z.string().optional(), limite:z.number().int().min(1).max(100).optional() } }, async(v)=>output(await tickPlans(env,{planId:v.plano_id,limit:v.limite})));
  server.registerTool("pausar_plano", { description:"Pausa plano sem apagar branches.", inputSchema:{ plano_id:z.string().min(1) } }, async(v)=>output((await setPlanStatus(env,v.plano_id,"PAUSED"))||{error:"NOT_FOUND"}));
  server.registerTool("retomar_plano", { description:"Retoma plano pausado.", inputSchema:{ plano_id:z.string().min(1) } }, async(v)=>output((await setPlanStatus(env,v.plano_id,"RUNNING"))||{error:"NOT_FOUND"}));
  server.registerTool("cancelar_plano", { description:"Cancela plano e branches ainda não concluídos, preservando histórico.", inputSchema:{ plano_id:z.string().min(1) } }, async(v)=>output((await setPlanStatus(env,v.plano_id,"CANCELLED"))||{error:"NOT_FOUND"}));
  server.registerTool("obter_plano_roteamento_fonte", { description:"Obtém o plano de roteamento mais recente por projeto/item/termo.", inputSchema:{ projeto_id:z.string().optional(), item_id:z.string().optional(), termo_coleta_id:z.string().optional() } }, async(v)=>output((await getSourceRoutingPlan(env,{projectId:v.projeto_id,itemId:v.item_id,collectionTermId:v.termo_coleta_id}))||{error:"NOT_FOUND"}));

  server.registerTool("anexar_script_projeto", { description:"CAMINHO PREFERENCIAL E OBRIGATORIO PARA SCRIPT textual: grava o roteiro diretamente no R2 e D1 em uma unica chamada MCP, sem ticket, sem URL externa e sem PUT. Idempotente pelo conteudo.", inputSchema:{ projeto_id:z.string().min(1), conteudo:z.string().min(1).max(2000000), nome_arquivo:z.string().min(1).optional() } }, async(v)=>output(await attachProjectScriptInline(request,env,{projectId:v.projeto_id,content:v.conteudo,fileName:v.nome_arquivo})));

  server.registerTool("anexar_arquivo_projeto", { description:"Prepara upload direto para R2 somente para arquivo binario/anexo. Para SCRIPT textual use obrigatoriamente anexar_script_projeto; SCRIPT nao gera ticket externo por esta ferramenta.", inputSchema:{ projeto_id:z.string().min(1), role:z.string().min(1), nome_arquivo:z.string().min(1), mime_type:z.string().optional(), tamanho_max:z.number().int().positive().optional() } }, async(v)=>{
    if(String(v.role||"").trim().toUpperCase()==="SCRIPT") return output({error:"SCRIPT_USE_INLINE_MCP",required_tool:"anexar_script_projeto",reason:"SCRIPT textual nao deve depender de uploadUrl/PUT externo"});
    return output(await prepareDirectUpload(request,env,{uploadType:"PROJECT_FILE",projectId:v.projeto_id,role:v.role,fileName:v.nome_arquivo,mimeType:v.mime_type,maxBytes:v.tamanho_max}));
  });
  server.registerTool("obter_conteudo_arquivo_projeto", { description:"Lê inline o arquivo textual mais recente de uma role do projeto.", inputSchema:{ projeto_id:z.string().min(1), role:z.string().min(1), versao:z.number().int().positive().optional() } }, async(v)=>output((await readProjectFile(env,v.projeto_id,v.role,v.versao))||{error:"NOT_FOUND"}));
  server.registerTool("baixar_arquivo_projeto", { description:"Gera link temporário de arquivo de projeto já armazenado no R2.", inputSchema:{ arquivo_id:z.string().min(1), validade_minutos:z.number().int().min(1).max(60).optional() } }, async(v)=>output((await getProjectFileLink(request,env,v.arquivo_id,v.validade_minutos||15))||{error:"NOT_FOUND"}));
  server.registerTool("registrar_qa_projeto", { description:"Registra evento QA do projeto sem reescrever arquivos ou assets.", inputSchema:{ projeto_id:z.string().min(1), status:z.string().min(1), detalhe:z.unknown().optional(), evento:z.string().optional() } }, async(v)=>output(await addProjectQaEvent(env,v.projeto_id,{status:v.status,detail:v.detalhe,event:v.evento})));

  server.registerTool("configurar_fontes_coleta", { description:"Cria/atualiza fonte HTTP de coleta. API key só pode ser referenciada por nome de binding; segredos não entram no D1.", inputSchema:{ fonte_id:z.string().optional(), nome:z.string().min(1), base_url:z.string().url(), image_path:z.string().min(1), thumbnail_path:z.string().optional(), query_param:z.string().optional(), limit_param:z.string().optional(), prioridade:z.number().int().min(1).max(10).optional(), ativa:z.boolean().optional(), api_key_env:z.string().optional(), api_key_header:z.string().optional(), headers:z.record(z.string(),z.string()).optional(), timeout_ms:z.number().int().min(1000).max(60000).optional(), dominio:z.string().optional(), nota:z.string().optional() } }, async(v)=>output(await configureCollectionSource(env,{id:v.fonte_id,name:v.nome,baseUrl:v.base_url,imagePath:v.image_path,thumbnailPath:v.thumbnail_path,queryParam:v.query_param,limitParam:v.limit_param,priority:v.prioridade,active:v.ativa,apiKeyEnv:v.api_key_env,apiKeyHeader:v.api_key_header,headers:v.headers,timeoutMs:v.timeout_ms,domain:v.dominio,note:v.nota})));
  server.registerTool("listar_fontes_coleta", { description:"Lista fontes de coleta e métricas sem expor valores de secrets.", inputSchema:{} }, async()=>output(await listCollectionSources(env)));
  server.registerTool("criar_lote_coleta_automatica", { description:"Cria lote a partir de linhas TERMO | quantidade | tipo | universo.", inputSchema:{ nome:z.string().optional(), termos:z.string().min(1), max_urls_por_termo:z.number().int().min(1).max(500).optional(), max_fontes_por_termo:z.number().int().min(1).max(50).optional(), max_rodadas:z.number().int().min(1).max(20).optional(), modo_noturno:z.boolean().optional() } }, async(v)=>output(await createCollectionBatch(env,{name:v.nome,termsText:v.termos,maxUrlsPerTerm:v.max_urls_por_termo,maxSourcesPerTerm:v.max_fontes_por_termo,maxRoundsPerTerm:v.max_rodadas,nightMode:v.modo_noturno})));
  server.registerTool("executar_coleta_automatica", { description:"ACK assíncrono: consulta fontes, persiste candidatas e encaminha URLs ao FAST PUSH interno.", inputSchema:{ lote_id:z.string().min(1), rodadas:z.number().int().min(1).max(10).optional(), operation_id:z.string().optional() } }, async(v)=>output(await enqueueCollection(env,{batchId:v.lote_id,rounds:v.rodadas,operationId:v.operation_id})));
  server.registerTool("obter_status_coleta_automatica", { description:"Retorna lote, termos, últimas execuções e eventos de coleta.", inputSchema:{ lote_id:z.string().min(1) } }, async(v)=>output((await collectionStatus(env,v.lote_id))||{error:"NOT_FOUND"}));
  server.registerTool("listar_lotes_coleta_automatica", { description:"Lista lotes de coleta automática.", inputSchema:{ limite:z.number().int().min(1).max(200).optional() } }, async(v)=>output(await listCollectionBatches(env,v.limite||50)));
  server.registerTool("controlar_lote_coleta", { description:"Pausa, retoma ou cancela lote sem apagar histórico.", inputSchema:{ lote_id:z.string().min(1), acao:z.enum(["PAUSE","RESUME","CANCEL"]) } }, async(v)=>output((await controlCollectionBatch(env,v.lote_id,v.acao))||{error:"NOT_FOUND"}));
  server.registerTool("listar_para_analise_coleta", { description:"Agrega candidatas de coleta por fonte/status e aponta duplicatas normalizadas.", inputSchema:{ lote_id:z.string().min(1) } }, async(v)=>output(await collectionAnalysis(env,v.lote_id)));
  server.registerTool("gerar_relatorio_coleta", { description:"Gera relatório lógico do lote com falhas recentes, sem criar arquivo intermediário.", inputSchema:{ lote_id:z.string().min(1) } }, async(v)=>output((await collectionReport(env,v.lote_id))||{error:"NOT_FOUND"}));
  server.registerTool("obter_log_detalhado_coleta", { description:"Retorna o log detalhado persistido de source runs e eventos do lote.", inputSchema:{ lote_id:z.string().min(1) } }, async(v)=>output((await collectionStatus(env,v.lote_id))||{error:"NOT_FOUND"}));


  // --- V2 0.7: remaining historical compatibility surface ---
  server.registerTool("excluir_asset_permanentemente", { description:"Exclusão irreversível com confirmar=true. Desvincula referências operacionais e remove o objeto R2 somente quando a chave não é compartilhada por outro asset.", inputSchema:{ asset_id:z.string().min(1), confirmar:z.boolean() } }, async(v)=>output(await deleteAssetPermanently(env,v.asset_id,v.confirmar)));
  server.registerTool("excluir_pendentes_permanentemente_em_lote", { description:"Exclui somente assets ainda Pendentes; exige confirmar=true e preserva qualquer objeto R2 compartilhado.", inputSchema:{ asset_ids:z.array(z.string()).min(1).max(200), confirmar:z.boolean() } }, async(v)=>output(await deletePendingAssetsPermanently(env,v.asset_ids,v.confirmar)));
  server.registerTool("excluir_assets_permanentemente_em_lote", { description:"Exclusão irreversível em massa no D1 e no R2. Objetos ausentes no bucket têm somente o metadado morto removido; objetos compartilhados são preservados.", inputSchema:{ asset_ids:z.array(z.string()).min(1).max(500), confirmar:z.boolean() } }, async(v)=>output(await deleteAssetsPermanently(env,v.asset_ids,v.confirmar)));
  server.registerTool("atualizar_manifesto_recuperacao_d1_r2", { description:"Atualiza no R2 o arquivo canônico que descreve a estrutura do D1 e os prefixos de sidecars de recuperação.", inputSchema:{ motivo:z.string().optional() } }, async(v)=>output(await writeD1StructureManifest(env,v.motivo||"MCP_REFRESH",null)));

  server.registerTool("preparar_upload_zip", { description:"Gera ticket temporário para upload direto de ZIP ao R2. O MCP nunca transporta o binário.", inputSchema:{ nome_arquivo:z.string().optional() } }, async(v)=>output(await prepareZipUpload(request,env,v.nome_arquivo||"importacao.zip")));
  server.registerTool("importar_zip_por_url", { description:"Importa ZIP por HTTPS pública; origem local/sandbox recebe ticket de upload direto em vez de atravessar o MCP.", inputSchema:{ url:z.string().min(1), nome_arquivo:z.string().min(1), manifesto_txt:z.string().optional() } }, async(v)=>{ if(/^https?:\/\//i.test(v.url))return output(await importZipByUrl(env,{url:v.url,fileName:v.nome_arquivo,manifestText:v.manifesto_txt})); return output(await prepareZipUpload(request,env,v.nome_arquivo)); });
  server.registerTool("importar_zip_arquivo", { description:"Compatibilidade para ZIP anexado. Se o file object expõe URL HTTPS, importa por URL; caso contrário devolve ticket PUT direto ao R2.", inputSchema:{ arquivo:z.unknown(), manifesto_txt:z.string().optional() } }, async(v)=>{ const f=(v.arquivo&&typeof v.arquivo==="object"?v.arquivo:{}) as Record<string,unknown>; const url=String(f.download_url||f.url||f.href||""); const name=String(f.name||f.filename||"importacao.zip"); return output(/^https?:\/\//i.test(url)?await importZipByUrl(env,{url,fileName:name,manifestText:v.manifesto_txt}):await prepareZipUpload(request,env,name)); });
  server.registerTool("processar_importacao_zip", { description:"Processa/reprocessa idempotentemente ZIP recebido no R2, lê IMPORTACAO.txt, extrai mídia e cataloga no D1.", inputSchema:{ importacao_id:z.string().min(1) } }, async(v)=>output(await queueZipImport(env,v.importacao_id)));
  server.registerTool("sincronizar_r2", { description:"Lista objetos R2 não catalogados sem modificar assets automaticamente.", inputSchema:{ prefixo:z.string().optional(), limite:z.number().int().min(1).max(1000).optional() } }, async(v)=>output(await syncR2Uncataloged(env,{prefix:v.prefixo,limit:v.limite})));
  server.registerTool("importar_midia_arquivo", { description:"Compatibilidade segura para mídia anexada: usa URL pública do file object quando disponível; senão devolve ticket de upload direto. Binários não atravessam o MCP.", inputSchema:{ arquivo:z.unknown(), nome:z.string().min(1), universo:z.string().optional(), tipo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).optional(), projeto_origem:z.string().optional(), referencia_roteiro:z.string().optional(), referencia_visual:z.string().optional(), fonte_url:z.string().optional(), nota_operacional:z.string().optional(), status_qa:z.string().optional() } }, async(v)=>{ const f=(v.arquivo&&typeof v.arquivo==="object"?v.arquivo:{}) as Record<string,unknown>; const url=String(f.download_url||f.url||f.href||""); if(/^https?:\/\//i.test(url))return output(await enqueueFastPushItems(env,[{url,projectId:v.projeto_origem,universe:v.universo,subject:v.sujeito||v.nome,tags:v.tags}],{type:"IMPORT_MEDIA_FILE_URL"})); const fileName=String(f.name||f.filename||`${v.nome}.bin`); const mime=String(f.mime_type||f.type||"")||undefined; const size=Number(f.size_bytes||f.size||30*1024*1024); return output(await prepareDirectUpload(request,env,{fileName,mimeType:mime,maxBytes:Math.min(Math.max(size,1024),100*1024*1024),uploadType:"CANDIDATE",projectId:v.projeto_origem,universe:v.universo,subject:v.sujeito||v.nome,tags:v.tags})); });

  server.registerTool("exportar_assets_zip", { description:"ACK assíncrono: gera ZIP streaming no R2 e reutiliza conjunto idêntico por até 48h.", inputSchema:{ asset_ids:z.array(z.string()).min(1).max(500), nome_zip:z.string().optional(), validade_minutos:z.number().int().min(1).max(60).optional() } }, async(v)=>{ const q=await queueAssetExport(env,{assetIds:v.asset_ids,name:v.nome_zip}); if("export_id" in q && "reused" in q && q.reused)return output({...q,link:await getAssetExportLink(request,env,String(q.export_id),v.validade_minutos||30)}); return output(q); });
  server.registerTool("obter_status_export_assets_zip", { description:"Consulta o estado de um ZIP de assets enfileirado sem baixar o arquivo.", inputSchema:{ export_id:z.string().min(1) } }, async(v)=>output(await getAssetExportStatus(env,v.export_id)));
  server.registerTool("obter_link_export_assets_zip", { description:"Quando o ZIP de assets estiver READY, gera link temporário direto para download sem transportar o binário pelo MCP.", inputSchema:{ export_id:z.string().min(1), validade_minutos:z.number().int().min(1).max(60).optional() } }, async(v)=>output(await getAssetExportLink(request,env,v.export_id,v.validade_minutos||30)));

  const materializationItem=z.object({ item_id:z.string().min(1), arquivo_alvo:z.string().optional(), conceito:z.string().optional(), referencia_visual:z.string().optional(), universo:z.string().optional(), preset:z.string().optional(), slot:z.string().optional(), tipo:z.string().optional(), sujeito:z.string().optional(), tags:z.array(z.string()).optional(), referencia_roteiro:z.string().optional(), usado_para:z.string().optional(), min_width:z.number().int().positive().optional(), min_height:z.number().int().positive().optional(), transparencia_necessaria:z.boolean().optional(), candidatas:z.array(z.object({priority:z.number().int().optional(),url:z.string().url(),source:z.string().optional()})).max(5).optional() });
  server.registerTool("materializar_lote", { description:"Cria lote histórico e envia candidatas ao FAST PUSH/Queue. ACK imediato; downloads ocorrem no Data Plane.", inputSchema:{ batch_id:z.string().optional(), projeto:z.string().min(1), itens:z.array(materializationItem).min(1).max(40), execution_id:z.string().optional() } }, async(v)=>output(await materializeBatchCompat(env,{batchId:v.batch_id,project:v.projeto,items:v.itens})));
  server.registerTool("criar_fila_materializacao_continua", { description:"Cria fila persistente de materialização sem iniciar download.", inputSchema:{ batch_id:z.string().optional(), projeto:z.string().min(1) } }, async(v)=>output(await createContinuousMaterializationQueue(env,{batchId:v.batch_id,project:v.projeto})));
  server.registerTool("adicionar_itens_fila_materializacao", { description:"Adiciona até 40 itens à fila e envia URLs válidas à Queue.", inputSchema:{ batch_id:z.string().min(1), itens:z.array(materializationItem).min(1).max(40), execution_id:z.string().optional() } }, async(v)=>output(await addMaterializationItems(env,v.batch_id,v.itens)));
  server.registerTool("obter_assets_para_qa_lote", { description:"Retorna QA em LINKS_ONLY com URLs temporárias do R2, sem resource_link de binário no chat.", inputSchema:{ batch_id:z.string().min(1), limite:z.number().int().min(1).max(100).optional(), execution_id:z.string().optional() } }, async(v)=>output(await assetsForQa(request,env,v.batch_id,v.limite||20)));
  server.registerTool("registrar_qa_lote", { description:"Registra QA. APROVADO congela/cataloga; REJEITADO descarta candidatas temporárias sem apagar histórico.", inputSchema:{ batch_id:z.string().min(1), decisoes:z.array(z.object({item_id:z.string().min(1),status:z.string().min(1),observacao:z.string().optional()})).min(1).max(100), execution_id:z.string().optional() } }, async(v)=>output(await registerMaterializationQa(env,v.batch_id,v.decisoes)));
  server.registerTool("adicionar_candidatas_item", { description:"Acrescenta novas URLs ao item e retoma a materialização pela Queue.", inputSchema:{ batch_id:z.string().min(1), item_id:z.string().min(1), projeto_id:z.string().optional(), candidatas:z.array(z.object({priority:z.number().int().optional(),url:z.string().url(),source:z.string().optional()})).min(1).max(20), execution_id:z.string().optional() } }, async(v)=>output(await addCandidatesToMaterializationItem(env,{batchId:v.batch_id,itemId:v.item_id,candidates:v.candidatas})));
  server.registerTool("aplicar_correcao_tecnica", { description:"Preserva a linhagem e aceita resultado técnico externo por URL. Sem url_resultado retorna TRANSFORM_SERVICE_REQUIRED em vez de fingir transformação dentro do Worker.", inputSchema:{ batch_id:z.string().min(1), item_id:z.string().min(1), projeto_id:z.string().optional(), parent_materialization_id:z.string().optional(), operacao:z.string().optional(), operacoes:z.array(z.string()).optional(), technical_fixes:z.array(z.string()).optional(), technical_parameters:z.record(z.string(),z.unknown()).optional(), reavaliado_antes_terceira:z.boolean().optional(), url_resultado:z.string().optional(), execution_id:z.string().optional() } }, async(v)=>output(await applyTechnicalCorrectionCompat(env,{batchId:v.batch_id,itemId:v.item_id,urlResult:v.url_resultado,operations:[...(v.operacao?[v.operacao]:[]),...(v.operacoes||[]),...(v.technical_fixes||[])],parameters:v.technical_parameters})));
  server.registerTool("exportar_zip_arquivo", { description:"Gera ZIP assíncrono dos assets congelados do lote usando o mesmo exportador streaming do R2.", inputSchema:{ batch_id:z.string().min(1), nome_zip:z.string().optional(), arquivos:z.array(z.object({item_id:z.string(),arquivo_alvo:z.string()})).optional(), execution_id:z.string().optional() } }, async(v)=>output(await exportFrozenMaterializationBatch(env,v.batch_id,v.nome_zip)));
  server.registerTool("cancelar_lote_materializacao", { description:"Cancela tentativas futuras sem apagar arquivos aprovados ou histórico.", inputSchema:{ batch_id:z.string().min(1), execution_id:z.string().optional() } }, async(v)=>output((await cancelMaterializationBatch(env,v.batch_id))||{error:"BATCH_NOT_FOUND"}));
  server.registerTool("limpar_temporarios_lote", { description:"Remove apenas objetos temporários não aprovados de lote terminal; exige confirmar=true.", inputSchema:{ batch_id:z.string().min(1), confirmar:z.boolean() } }, async(v)=>output(await cleanMaterializationTemporaries(env,v.batch_id,v.confirmar)));

  server.registerTool("vasculhar_r2", {
    description: "Procura em todo o R2 os arquivos físicos correspondentes aos assets Pendentes. Informa quais já estão no caminho atual, quais foram encontrados em outra chave com alta confiança e quais continuam sem correspondência. Somente leitura.",
    inputSchema: { max_objetos:z.number().int().min(1000).max(50000).optional(), limite_pendentes:z.number().int().min(1).max(1000).optional() },
  }, async ({max_objetos,limite_pendentes}) => output(await scanPendingMedia(requestFor(request,`/storage/r2/pending-reconcile?maxObjects=${max_objetos||20000}&limit=${limite_pendentes||500}`),env)));

  server.registerTool("reparar_pendentes_r2", {
    description: "Religa somente assets Pendentes cujo arquivo foi encontrado no R2 com correspondência forte. Preserva o status Pendente e registra a troca de r2_key na nota operacional.",
    inputSchema: { asset_ids:z.array(z.string()).max(500).optional(), max_objetos:z.number().int().min(1000).max(50000).optional() },
  }, async ({asset_ids,max_objetos}) => output(await repairPendingMedia(env,{assetIds:asset_ids,maxObjects:max_objetos||20000})));

  server.registerTool("excluir_pendentes_nao_encontrados_r2", {
    description: "Refaz uma varredura completa do bucket e exclui permanentemente apenas Pendentes que continuarem sem correspondência física. Exige confirmar=true; a política é recapturar mídia nova em vez de insistir na reconciliação.",
    inputSchema: { confirmar:z.boolean(), max_objetos:z.number().int().min(1000).max(50000).optional() },
  }, async ({confirmar,max_objetos}) => output(await deleteMissingPendingMedia(env,{confirm:confirmar,maxObjects:max_objetos||20000})));

  server.registerTool("explorar_r2_fisico", {
    description: "Explorador físico somente leitura do bucket R2 por prefixos/pastas. Ferramenta de diagnóstico; não reconcilia Pendentes.",
    inputSchema: { prefixo:z.string().optional(), max_objetos:z.number().int().min(100).max(50000).optional() },
  }, async ({prefixo,max_objetos}) => output(await exploreR2(requestFor(request,`/storage/r2/explore?prefix=${encodeURIComponent(prefixo||"")}&maxObjects=${max_objetos||10000}`),env)));

  server.registerTool("auditar_armazenamento_r2", {
    description: "Auditoria completa somente leitura: cruza todas as referências conhecidas do D1 com o inventário físico do R2 e reporta faltantes, órfãos e chaves compartilhadas.",
    inputSchema: { max_objetos:z.number().int().min(1000).max(50000).optional() },
  }, async ({max_objetos}) => output(await fullStorageAudit(env,max_objetos||10000)));

  return server;
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
  const handler = createMcpHandler(() => createServer(env, request), { route: "/mcp", responseMode: "json" });
  return handler(request, env, ctx);
}
