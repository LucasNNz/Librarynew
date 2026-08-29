import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import type { Env } from "./types";
import { catalogStats, getAsset, getAssetLink, getAssetLinks, listAssets, listUniverses } from "./core/assets";
import { approveCandidate, fastPush, getOperation, listCandidates, rejectCandidate } from "./core/ingest";
import { approvePendingAssets, catalogAsset, findDuplicateR2Keys, getAssetHistory, registerAssetUsage, rejectAsset, restoreAsset, updateAssetMetadata } from "./core/asset-ops";
import { addAssetsToBatch, createBatch, createRequest, generateBatchManifest, getBatch, listBatches, listImports, listRequests, removeAssetsFromBatch, updateBatchStatus, updateRequest } from "./core/work-items";
import { integritySample } from "./core/storage";
import { createAutomaticProject, getAutomaticProject, getAutomaticProjectDetails, getOperationalSnapshot, listAutomaticProjects } from "./core/projects";

const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function requestFor(baseRequest: Request, path: string, init?: RequestInit) {
  return new Request(new URL(path, baseRequest.url), init);
}

function createServer(env: Env, request: Request) {
  const server = new McpServer({ name: "corvo-library-v2", version: "0.3.0" });

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
      const dossiers = [];
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
    const results = [];
    for (const usage of usos) results.push(await registerAssetUsage(request, usage, env));
    return output({ registrados: results.filter(value => !("error" in value)).length, resultados: results });
  });

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
      body: JSON.stringify({ urls: urls.map(url => ({ url, universe: universo, subject: sujeito, projectId: projeto_id, itemId: item_id, tags })) }),
    });
    return output(await fastPush(synthetic, env));
  });

  server.registerTool("materializar_urls_lote", {
    description: "Alias V2 do FAST PUSH: agenda materialização de URLs em Queue e retorna operation_id sem transportar binários pelo MCP.",
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(200),
      universo: z.string().optional(),
      sujeito: z.string().optional(),
    },
  }, async ({ urls, universo, sujeito }) => {
    const synthetic = requestFor(request, "/fast-push", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ urls:urls.map(url => ({ url, universe:universo, subject:sujeito })) }) });
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
    const results = [];
    for (const candidateId of candidate_ids) results.push({ candidateId, ...(await approveCandidate(candidateId, env)) });
    return output({ results });
  });

  server.registerTool("rejeitar_candidatas_fast_push_lote", {
    description: "Rejeita candidatas e remove o objeto temporário do R2 quando existir.",
    inputSchema: { candidate_ids: z.array(z.string()).min(1).max(100) },
  }, async ({ candidate_ids }) => {
    const results = [];
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
    description: "Retorna resumo de estoque por status e facetas por universo.",
    inputSchema: {},
  }, async () => output({ stats: await catalogStats(env), universes: await listUniverses(env) }));

  return server;
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
  const handler = createMcpHandler(() => createServer(env, request), { route: "/mcp", responseMode: "json" });
  return handler(request, env, ctx);
}
