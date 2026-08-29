"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Asset, AutomaticProject, Batch, Candidate, CatalogResponse, CatalogStats, ImportRecord, LibraryRequest, Operation, UniverseFacet } from "../lib/contracts";

type Health = {
  app: "ok";
  architecture: "CLOUDFLARE_CORE";
  coreConfigured: boolean;
  core: { ok: boolean; d1?: string; r2?: string; schema?: string; queue?: string; queueBacklog?: number | null; error?: string };
};

const nav = ["Catálogo", "Projetos", "Solicitações", "Lotes", "Importações", "Coleta automática", "Operação", "Políticas", "Estoque & giro", "Inbox candidatas", "Pendentes", "Rejeitados", "Configurações"];

function Mark() {
  return <span className="mark" aria-hidden="true"><i /></span>;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function statusClass(status: string) {
  if (status === "APPROVED" || status === "COMPLETED" || status === "MATERIALIZED") return "okState";
  if (status === "REJECTED" || status === "FAILED") return "badState";
  return "waitState";
}

export default function Home() {
  const [active, setActive] = useState("Catálogo");
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<CatalogStats>({ total:0, approved:0, pending:0, rejected:0, universes:0, bytes:0, uses:0 });
  const [universes, setUniverses] = useState<UniverseFacet[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [universe, setUniverse] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateState, setCandidateState] = useState("MATERIALIZED");
  const [candidateLoading, setCandidateLoading] = useState(false);

  const [pushUrls, setPushUrls] = useState("");
  const [pushUniverse, setPushUniverse] = useState("");
  const [pushSubject, setPushSubject] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [pushError, setPushError] = useState("");
  const [requests, setRequests] = useState<LibraryRequest[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [recordLoading, setRecordLoading] = useState(false);
  const [requestProject, setRequestProject] = useState("");
  const [requestItems, setRequestItems] = useState("");
  const [batchName, setBatchName] = useState("");
  const [batchProject, setBatchProject] = useState("");
  const [projects, setProjects] = useState<AutomaticProject[]>([]);
  const [projectName, setProjectName] = useState("");
  const [integrity, setIntegrity] = useState<{checked:number;present:number;missing:number;missingItems:Array<{id:string;r2Key:string;exists:boolean}>}|null>(null);
  const [r2Objects, setR2Objects] = useState<Array<{key:string;size:number;etag:string;uploaded:string}>>([]);

  const refreshHealth = useCallback(async () => {
    const response = await fetch("/api/health", { cache:"no-store" });
    setHealth(await response.json());
  }, []);

  const refreshStats = useCallback(async () => {
    const [statsResponse, universeResponse] = await Promise.all([
      fetch("/api/catalog/stats", { cache:"no-store" }),
      fetch("/api/catalog/universes", { cache:"no-store" }),
    ]);
    if (statsResponse.ok) setStats(await statsResponse.json());
    if (universeResponse.ok) {
      const value = await universeResponse.json();
      setUniverses(Array.isArray(value.universes) ? value.universes : []);
    }
  }, []);

  const fetchCatalog = useCallback(async (cursor?: string | null, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    const params = new URLSearchParams({ limit:"48" });
    if (query.trim()) params.set("q", query.trim());
    if (universe) params.set("universe", universe);
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/assets?${params}`, { cache:"no-store" });
      if (!response.ok) return;
      const value = await response.json() as CatalogResponse;
      setAssets(current => append ? [...current, ...(value.items || [])] : (value.items || []));
      setTotal(Number(value.total || 0));
      setNextCursor(value.nextCursor || null);
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [query, universe, status]);

  const refreshRecords = useCallback(async (module: string) => {
    setRecordLoading(true);
    try {
      if (module === "Projetos") {
        const response = await fetch("/api/projects?limit=100", { cache:"no-store" });
        if (response.ok) { const value = await response.json(); setProjects(Array.isArray(value.items) ? value.items : []); }
      } else if (module === "Solicitações") {
        const response = await fetch("/api/requests?limit=100", { cache:"no-store" });
        if (response.ok) { const value = await response.json(); setRequests(Array.isArray(value.items) ? value.items : []); }
      } else if (module === "Lotes") {
        const response = await fetch("/api/batches?limit=100", { cache:"no-store" });
        if (response.ok) { const value = await response.json(); setBatches(Array.isArray(value.items) ? value.items : []); }
      } else if (module === "Importações") {
        const response = await fetch("/api/imports?limit=100", { cache:"no-store" });
        if (response.ok) { const value = await response.json(); setImports(Array.isArray(value.items) ? value.items : []); }
      }
    } finally { setRecordLoading(false); }
  }, []);

  const refreshOperations = useCallback(async () => {
    const [integrityResponse,r2Response]=await Promise.all([fetch("/api/storage/integrity?limit=100",{cache:"no-store"}),fetch("/api/storage/r2?limit=50&prefix=assets/",{cache:"no-store"})]);
    if(integrityResponse.ok)setIntegrity(await integrityResponse.json());
    if(r2Response.ok){const value=await r2Response.json();setR2Objects(Array.isArray(value.objects)?value.objects:[]);}
  },[]);

  const refreshCandidates = useCallback(async () => {
    setCandidateLoading(true);
    try {
      const response = await fetch(`/api/candidates?status=${encodeURIComponent(candidateState)}&limit=100`, { cache:"no-store" });
      if (!response.ok) return;
      const value = await response.json();
      setCandidates(Array.isArray(value.items) ? value.items : []);
    } finally {
      setCandidateLoading(false);
    }
  }, [candidateState]);

  useEffect(() => {
    void Promise.all([refreshHealth(), refreshStats()]);
  }, [refreshHealth, refreshStats]);

  useEffect(() => {
    if (active === "Pendentes" && status !== "PENDING") setStatus("PENDING");
    if (active === "Rejeitados" && status !== "REJECTED") setStatus("REJECTED");
  }, [active, status]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchCatalog(null, false), 280);
    return () => clearTimeout(timer);
  }, [fetchCatalog]);

  useEffect(() => {
    if (active === "Inbox candidatas") void refreshCandidates();
    if (["Projetos","Solicitações","Lotes","Importações"].includes(active)) void refreshRecords(active);
    if (active === "Operação") void refreshOperations();
  }, [active, refreshCandidates, refreshRecords, refreshOperations]);

  useEffect(() => {
    if (!operation || ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"].includes(operation.status)) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/operations/${encodeURIComponent(operation.id)}`, { cache:"no-store" });
      if (response.ok) setOperation(await response.json());
    }, 1500);
    return () => clearInterval(timer);
  }, [operation]);

  const coreState = !health ? "VERIFICANDO" : health.core.ok ? "ONLINE" : health.coreConfigured ? "INDISPONÍVEL" : "AGUARDANDO CONFIGURAÇÃO";
  const selectedUniverse = useMemo(() => universes.find(item => item.name === universe), [universes, universe]);

  async function submitPush(event: FormEvent) {
    event.preventDefault();
    setPushError("");
    const urls = pushUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) { setPushError("Cole pelo menos uma URL."); return; }
    setPushBusy(true);
    try {
      const response = await fetch("/api/fast-push", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({ urls:urls.map(url => ({ url, universe:pushUniverse || undefined, subject:pushSubject || undefined })) }),
      });
      const value = await response.json();
      if (!response.ok) { setPushError(value.error || `HTTP ${response.status}`); return; }
      setOperation({ id:value.operationId, type:"FAST_PUSH", status:"QUEUED", requested:value.accepted, succeeded:0, failed:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    } finally {
      setPushBusy(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault(); if (!projectName.trim()) return;
    const response=await fetch("/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({nome:projectName})});
    if(response.ok){setProjectName("");await refreshRecords("Projetos");}
  }

  async function createLibraryRequest(event: FormEvent) {
    event.preventDefault();
    if (!requestProject.trim() || !requestItems.trim()) return;
    const response = await fetch("/api/requests", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ project:requestProject, items:requestItems }) });
    if (response.ok) { setRequestProject(""); setRequestItems(""); await refreshRecords("Solicitações"); }
  }

  async function createLibraryBatch(event: FormEvent) {
    event.preventDefault();
    if (!batchName.trim()) return;
    const response = await fetch("/api/batches", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ name:batchName, project:batchProject || undefined }) });
    if (response.ok) { setBatchName(""); setBatchProject(""); await refreshRecords("Lotes"); }
  }

  async function generateManifest(batchId: string) {
    const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}/manifest`, { method:"POST" });
    if (response.ok) await refreshRecords("Lotes");
  }

  async function decideCandidate(candidateId: string, decision: "approve" | "reject") {
    const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/${decision}`, { method:"POST" });
    if (response.ok) {
      await Promise.all([refreshCandidates(), refreshStats(), fetchCatalog(null, false)]);
    }
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><Mark /><div><strong>CORVO</strong><span>LIBRARY V2</span></div></div>
      <p className="navLabel">NAVEGAÇÃO</p>
      <nav>{nav.map(item => <button key={item} className={active===item ? "active" : ""} onClick={() => setActive(item)}><span className="glyph">{item === "Catálogo" ? "▦" : item === "Projetos" ? "◆" : item === "Operação" ? "⚙" : item === "Inbox candidatas" ? "▣" : item === "Coleta automática" ? "↯" : "•"}</span>{item}</button>)}</nav>
      <div className="sideStatus"><span className={health?.core.ok ? "dot live" : "dot"}/><div><strong>Corvo Core</strong><small>{coreState}</small></div></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><b>CORVO LIBRARY V2</b><span>D1 histórico direto · R2 por binding · FAST PUSH em Queue</span></div>
        <div className="envBadge">V2 CORE 0.3</div>
      </header>

      <div className="content">
        <div className="titleRow"><div><h1>{active}</h1><p>{active === "Catálogo" ? "Sem conversão permanente: D1 estrutura, R2 armazena e o Worker materializa." : active === "Configurações" ? "Infraestrutura por bindings; nenhuma chave R2 é gravada no banco." : "Reimplementação limpa por equivalência funcional."}</p></div></div>

        <section className="healthGrid">
          <article><small>APP VERCEL</small><strong>ONLINE</strong><span>Interface e BFF</span></article>
          <article><small>CORVO CORE</small><strong className={health?.core.ok ? "good" : "warn"}>{coreState}</strong><span>Worker/API</span></article>
          <article><small>D1 / SCHEMA</small><strong>{health?.core.d1?.toUpperCase() || "—"} / {health?.core.schema?.toUpperCase() || "—"}</strong><span>47 tabelas históricas + v2_*</span></article>
          <article><small>R2 / QUEUE</small><strong>{health?.core.r2?.toUpperCase() || "—"} / {health?.core.queue?.toUpperCase() || "—"}</strong><span>{health?.core.queueBacklog != null ? `${health.core.queueBacklog} na fila` : "bindings nativos"}</span></article>
        </section>

        {["Catálogo","Pendentes","Rejeitados"].includes(active) && <>
          <section className="metricStrip">
            <div><strong>{stats.total.toLocaleString("pt-BR")}</strong><span>Total</span></div>
            <div><strong>{stats.approved.toLocaleString("pt-BR")}</strong><span>Aprovados</span></div>
            <div><strong>{stats.pending.toLocaleString("pt-BR")}</strong><span>Pendentes</span></div>
            <div><strong>{stats.universes.toLocaleString("pt-BR")}</strong><span>Universos</span></div>
            <div><strong>{stats.uses.toLocaleString("pt-BR")}</strong><span>Usos</span></div>
            <div><strong>{formatBytes(stats.bytes)}</strong><span>Mídia catalogada</span></div>
          </section>

          <section className="catalogTools">
            <label className="searchBox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, universo, personagem ou tag..." /></label>
            <select value={universe} onChange={e=>setUniverse(e.target.value)}><option value="">Todos os universos</option>{universes.map(item => <option key={item.name} value={item.name}>{item.name} ({item.total})</option>)}</select>
            <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="APPROVED">Aprovados</option><option value="PENDING">Pendentes</option><option value="REJECTED">Rejeitados</option></select>
          </section>
          {selectedUniverse && <div className="filterContext"><b>{selectedUniverse.name}</b><span>{selectedUniverse.approved} aprovados · {selectedUniverse.pending} pendentes · {selectedUniverse.rejected} rejeitados</span></div>}

          {!health?.coreConfigured && <div className="notice"><strong>Fundação criada.</strong><span>Falta apenas conectar o projeto ao Corvo Core. A V2 não solicitará credenciais Cloudflare na interface.</span></div>}

          {loading ? <div className="empty">Carregando catálogo…</div> : assets.length === 0 ? <div className="empty"><Mark /><strong>Nenhum asset para estes filtros</strong><span>O catálogo será lido diretamente do D1 restaurado, sem seed de produção ou snapshot intermediário.</span></div> : <>
            <div className="resultMeta"><span>{total.toLocaleString("pt-BR")} resultados</span><span>{assets.length.toLocaleString("pt-BR")} carregados</span></div>
            <div className="grid">{assets.map(asset => <article className="card" key={asset.id}>
              <div className="preview">{asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} loading="lazy" /> : <span>R2</span>}<em className={statusClass(asset.status)}>{asset.rawStatus || asset.status}</em></div>
              <div className="cardBody"><strong>{asset.name}</strong><span>{asset.universe || "Sem universo"}{asset.subject ? ` · ${asset.subject}` : ""}</span><div>{asset.tags.slice(0,3).map(tag => <small key={tag}>{tag}</small>)}</div><footer><code>{asset.id}</code><b>{asset.uses} usos</b></footer></div>
            </article>)}</div>
            {nextCursor && <div className="loadMore"><button disabled={loadingMore} onClick={() => void fetchCatalog(nextCursor, true)}>{loadingMore ? "Carregando…" : "Carregar mais"}</button></div>}
          </>}
        </>}

        {active === "Projetos" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">PROJETOS AUTOMÁTICOS</span><h2>Control plane preservado</h2><p>A V2 lê e cria projetos sobre <code>automatic_projects</code> sem reconciliação implícita ou varredura R2.</p><form className="pushForm" onSubmit={createProject}><input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="Nome do projeto"/><button className="primary">Criar projeto</button></form></div>
          <div className="recordList">{recordLoading?<div className="quiet">Carregando…</div>:projects.length===0?<div className="quiet">Nenhum projeto.</div>:projects.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.pipeline_status || item.status} · {item.approved_count||0}/{item.total_items||0} aprovados</span></div><code>{item.id}</code></article>)}</div>
        </section>}

        {active === "Solicitações" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">SOLICITAÇÕES</span><h2>Fila estrutural preservada</h2><p>Cria e lê diretamente a tabela histórica <code>requests</code>.</p>
            <form className="pushForm" onSubmit={createLibraryRequest}><input value={requestProject} onChange={e=>setRequestProject(e.target.value)} placeholder="Projeto"/><textarea rows={8} value={requestItems} onChange={e=>setRequestItems(e.target.value)} placeholder="Um item por linha"/><button className="primary">Criar solicitação</button></form>
          </div>
          <div className="recordList">{recordLoading ? <div className="quiet">Carregando…</div> : requests.length===0 ? <div className="quiet">Nenhuma solicitação.</div> : requests.map(item=><article key={item.id}><div><strong>{item.project}</strong><span>{item.item_count} itens · {item.status}</span></div><code>{item.id}</code></article>)}</div>
        </section>}

        {active === "Lotes" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">LOTES</span><h2>Lotes sobre o D1 histórico</h2><p>Manifestos novos são gravados diretamente no R2 via binding.</p>
            <form className="pushForm" onSubmit={createLibraryBatch}><input value={batchName} onChange={e=>setBatchName(e.target.value)} placeholder="Nome do lote"/><input value={batchProject} onChange={e=>setBatchProject(e.target.value)} placeholder="Projeto opcional"/><button className="primary">Criar lote</button></form>
          </div>
          <div className="recordList">{recordLoading ? <div className="quiet">Carregando…</div> : batches.length===0 ? <div className="quiet">Nenhum lote.</div> : batches.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.project || "Sem projeto"} · {item.status}</span></div><div className="inlineActions"><code>{item.id}</code><button onClick={()=>void generateManifest(item.id)}>Manifesto</button></div></article>)}</div>
        </section>}

        {active === "Importações" && <section className="modulePanel"><span className="eyebrow">HISTÓRICO</span><h2>Importações preservadas</h2><p>Nesta fase a V2 lê a tabela histórica sem reinterpretar os registros.</p><div className="recordList wide">{recordLoading ? <div className="quiet">Carregando…</div> : imports.length===0 ? <div className="quiet">Nenhuma importação.</div> : imports.map(item=><article key={item.id}><div><strong>{item.file_name}</strong><span>{formatBytes(item.size_bytes)} · {item.status}</span></div><code>{item.id}</code></article>)}</div></section>}

        {active === "Coleta automática" && <section className="modulePanel twoCol">
          <div>
            <span className="eyebrow">FAST PUSH V2</span>
            <h2>Materializar URLs sem transportar arquivos pelo MCP</h2>
            <p>O cliente envia apenas URLs e metadados. O Worker responde com um operation ID, a Queue baixa em background e o R2 recebe a mídia.</p>
            <form className="pushForm" onSubmit={submitPush}>
              <textarea rows={10} value={pushUrls} onChange={e=>setPushUrls(e.target.value)} placeholder={"Uma URL por linha\nhttps://.../imagem1.jpg\nhttps://.../imagem2.png"}/>
              <div className="formRow"><input value={pushUniverse} onChange={e=>setPushUniverse(e.target.value)} placeholder="Universo opcional"/><input value={pushSubject} onChange={e=>setPushSubject(e.target.value)} placeholder="Personagem/assunto opcional"/></div>
              {pushError && <div className="formError">{pushError}</div>}
              <button className="primary" disabled={pushBusy}>{pushBusy ? "Enviando…" : "Enviar para FAST PUSH"}</button>
            </form>
          </div>
          <div className="operationBox">
            <span className="eyebrow">OPERAÇÃO</span>
            {!operation ? <div className="quiet">Nenhuma operação iniciada nesta sessão.</div> : <>
              <div className="opHead"><code>{operation.id}</code><b className={statusClass(operation.status)}>{operation.status}</b></div>
              <div className="progress"><i style={{ width:`${operation.requested ? ((operation.succeeded + operation.failed) / operation.requested) * 100 : 0}%` }}/></div>
              <div className="opNumbers"><span><b>{operation.requested}</b>solicitados</span><span><b>{operation.succeeded}</b>materializados</span><span><b>{operation.failed}</b>falharam</span></div>
              <small>O MCP pode encerrar a chamada logo após receber este ID; o processamento continua na Cloudflare.</small>
            </>}
          </div>
        </section>}

        {active === "Inbox candidatas" && <>
          <section className="candidateToolbar"><div><b>Inbox de materialização</b><span>Aprovar move o objeto de incoming/ para assets/ e cria o AST-* no D1 histórico.</span></div><select value={candidateState} onChange={e=>setCandidateState(e.target.value)}><option value="MATERIALIZED">Materializadas</option><option value="RETRYING">Em retry</option><option value="FAILED">Falhas</option><option value="APPROVED">Aprovadas</option><option value="REJECTED">Rejeitadas</option></select></section>
          {candidateLoading ? <div className="empty">Carregando candidatas…</div> : candidates.length === 0 ? <div className="empty"><strong>Inbox vazia</strong><span>As mídias do FAST PUSH aparecem aqui depois que a Queue conclui a materialização.</span></div> : <div className="candidateGrid">{candidates.map(candidate => <article className="candidate" key={candidate.id}>
            <div className="candidatePreview">{candidate.previewUrl ? <img src={candidate.previewUrl} alt=""/> : <span>{candidate.status}</span>}</div>
            <div className="candidateBody"><div className="candidateTitle"><strong>{candidate.subject || "Sem assunto"}</strong><b className={statusClass(candidate.status)}>{candidate.status}</b></div><span>{candidate.universe || "Sem universo"}</span><code>{candidate.id}</code><small>{formatBytes(candidate.sizeBytes)} · tentativa {candidate.attempts}</small>{candidate.failureReason && <p>{candidate.failureReason}</p>}
              {candidate.status === "MATERIALIZED" && <div className="decisionRow"><button className="approve" onClick={() => void decideCandidate(candidate.id,"approve")}>Aprovar</button><button className="reject" onClick={() => void decideCandidate(candidate.id,"reject")}>Rejeitar</button></div>}
            </div>
          </article>)}</div>}
        </>}

        {active === "Operação" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">INTEGRIDADE</span><h2>D1 ↔ R2</h2><p>A checagem nunca corrige ou apaga automaticamente. Ela apenas prova se o objeto apontado por <code>r2_key</code> está presente.</p><div className="opNumbers"><span><b>{integrity?.checked ?? 0}</b>checados</span><span><b>{integrity?.present ?? 0}</b>presentes</span><span><b>{integrity?.missing ?? 0}</b>faltantes</span></div>{integrity?.missing ? <div className="formError">{integrity.missing} referências sem objeto no lote verificado.</div> : <div className="notice compact"><strong>Gate limpo</strong><span>Nenhum objeto faltante na amostra atual.</span></div>}</div>
          <div><span className="eyebrow">R2 — assets/</span><h2>Inventário físico</h2><div className="recordList">{r2Objects.length===0?<div className="quiet">Nenhum objeto carregado ou Core ainda desconectado.</div>:r2Objects.map(item=><article key={item.key}><div><strong>{item.key.split("/").pop()}</strong><span>{formatBytes(item.size)}</span></div><code>{item.key}</code></article>)}</div></div>
        </section>}

        {active === "Estoque & giro" && <section className="modulePanel"><span className="eyebrow">ESTOQUE</span><h2>{stats.approved.toLocaleString("pt-BR")} aprovados em {stats.universes.toLocaleString("pt-BR")} universos ativos</h2><p>Esta visão é derivada diretamente da tabela histórica <code>assets</code>.</p><div className="recordList wide">{universes.map(item=><article key={item.name}><div><strong>{item.name}</strong><span>{item.approved} aprovados · {item.pending} pendentes · {item.rejected} rejeitados</span></div><code>{item.total} total</code></article>)}</div></section>}

        {active === "Configurações" && <section className="modulePanel configPanel">
          <span className="eyebrow">INFRAESTRUTURA</span><h2>Bindings, não credenciais salvas</h2><p>A V2 não terá o formulário que quebrava a conexão R2 após atualizações.</p>
          <div className="bindingList"><div><b>DB</b><span>D1 · catálogo e estados históricos</span><em>{health?.core.d1 || "aguardando"}</em></div><div><b>MEDIA</b><span>R2 · corvoquiz-prod</span><em>{health?.core.r2 || "aguardando"}</em></div><div><b>MATERIALIZE_QUEUE</b><span>Queue · FAST PUSH</span><em>{health?.core.queue || "aguardando"}</em></div><div><b>CORVO_INTERNAL_KEY</b><span>Secret do Worker + Vercel; nunca no D1</span><em>{health?.coreConfigured ? "configurado no BFF" : "aguardando"}</em></div></div>
        </section>}

        {!["Catálogo","Projetos","Solicitações","Lotes","Importações","Coleta automática","Operação","Estoque & giro","Inbox candidatas","Pendentes","Rejeitados","Configurações"].includes(active) && <div className="modulePlaceholder"><strong>{active}</strong><p>Este módulo está na matriz de equivalência da V61.9. Ele será ligado ao núcleo V2 sem copiar bootstrap, recovery ou configuração legada.</p><span>EM DESENVOLVIMENTO CONTÍNUO</span></div>}
      </div>
    </section>
  </main>;
}
