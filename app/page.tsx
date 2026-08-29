"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Asset, AutomaticProject, Batch, Candidate, CatalogResponse, CatalogStats, DispatcherHealth, ImportRecord, LibraryRequest, MaterializationStats, Operation, StorageAudit, UniverseFacet } from "../lib/contracts";

type Health = {
  app: "ok";
  architecture: "CLOUDFLARE_CORE";
  coreConfigured: boolean;
  core: { ok: boolean; d1?: string; r2?: string; schema?: string; queue?: string; signing?: string; queueBacklog?: number | null; error?: string };
};

type InfrastructureProfile = {
  id: string;
  instanceId: string;
  revision: number;
  lockState: "LOCKED";
  bffProjectName: string;
  workerName: string;
  d1DatabaseName: string;
  r2BucketName: string;
  queueName: string;
  dlqName: string;
  configuredAt: number;
  updatedAt: number;
  lastVerifiedAt: number | null;
};

type InfrastructureDraft = Pick<InfrastructureProfile, "bffProjectName"|"workerName"|"d1DatabaseName"|"r2BucketName"|"queueName"|"dlqName">;

const defaultInfrastructureDraft: InfrastructureDraft = {
  bffProjectName:"corvo-library-v2",
  workerName:"corvo-core-v2",
  d1DatabaseName:"corvo-library-v2",
  r2BucketName:"corvoquiz-prod",
  queueName:"corvo-materialize-v2",
  dlqName:"corvo-materialize-v2-dlq",
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
  const [directFile, setDirectFile] = useState<File | null>(null);
  const [directBusy, setDirectBusy] = useState(false);
  const [directMessage, setDirectMessage] = useState("");
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
  const [dataHealth, setDataHealth] = useState<{ok:boolean;v2Orphans:number;activeHistoricalOrphans:number;catalog:{assetsMissingR2Key:number;duplicateAssetR2Keys:number};historical:Record<string,number>;activeHistoricalRisk:Record<string,number>;v2:Record<string,number>}|null>(null);
  const [r2Objects, setR2Objects] = useState<Array<{key:string;size:number;etag:string;uploaded:string}>>([]);
  const [storageAudit, setStorageAudit] = useState<StorageAudit | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [recentOperations, setRecentOperations] = useState<Array<Record<string,unknown>>>([]);
  const [dispatcherHealth, setDispatcherHealth] = useState<DispatcherHealth | null>(null);
  const [materializationStats, setMaterializationStats] = useState<MaterializationStats | null>(null);
  const [policyWorkspace, setPolicyWorkspace] = useState<{gaps:Array<Record<string,unknown>>;policies:Array<Record<string,unknown>>;recentEvents:Array<Record<string,unknown>>}|null>(null);
  const [policyTelemetry, setPolicyTelemetry] = useState<{policies:Array<Record<string,unknown>>;events:Array<Record<string,unknown>>}|null>(null);
  const [supervisorPanel, setSupervisorPanel] = useState<Record<string,unknown>|null>(null);
  const [stockDetail, setStockDetail] = useState<{totals:Array<Record<string,unknown>>;universes:Array<Record<string,unknown>>;rotation:Array<Record<string,unknown>>;policies:Array<Record<string,unknown>>}|null>(null);
  const [safeSettings, setSafeSettings] = useState<Array<{key:string;value:string;updated_at:number}>>([]);
  const [bindingStatus, setBindingStatus] = useState<Record<string,unknown>|null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [infraProfile, setInfraProfile] = useState<InfrastructureProfile | null>(null);
  const [infraEvents, setInfraEvents] = useState<Array<Record<string,unknown>>>([]);
  const [infraEditing, setInfraEditing] = useState(false);
  const [infraDraft, setInfraDraft] = useState<InfrastructureDraft>(defaultInfrastructureDraft);
  const [infraMessage, setInfraMessage] = useState("");
  const [infraSaving, setInfraSaving] = useState(false);

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

  const refreshPolicies = useCallback(async () => {
    const [workspaceResponse,telemetryResponse]=await Promise.all([fetch("/api/policies/workspace",{cache:"no-store"}),fetch("/api/policies/telemetry",{cache:"no-store"})]);
    if(workspaceResponse.ok)setPolicyWorkspace(await workspaceResponse.json());
    if(telemetryResponse.ok)setPolicyTelemetry(await telemetryResponse.json());
  },[]);

  const refreshSettings = useCallback(async () => {
    const [settingsResponse, infrastructureResponse] = await Promise.all([
      fetch("/api/settings",{cache:"no-store"}),
      fetch("/api/infrastructure/config",{cache:"no-store"}),
    ]);
    if(settingsResponse.ok){const value=await settingsResponse.json(); setSafeSettings(Array.isArray(value.items)?value.items:[]); setBindingStatus(value.bindings||null);}
    if(infrastructureResponse.ok){
      const value=await infrastructureResponse.json();
      const profile=(value.profile||null) as InfrastructureProfile|null;
      setInfraProfile(profile);
      setInfraEvents(Array.isArray(value.events)?value.events:[]);
      if(profile && !infraEditing)setInfraDraft({bffProjectName:profile.bffProjectName,workerName:profile.workerName,d1DatabaseName:profile.d1DatabaseName,r2BucketName:profile.r2BucketName,queueName:profile.queueName,dlqName:profile.dlqName});
    }
  },[infraEditing]);

  const refreshStock = useCallback(async () => {
    const response=await fetch("/api/stock",{cache:"no-store"}); if(response.ok)setStockDetail(await response.json());
  },[]);

  const refreshOperations = useCallback(async () => {
    const [integrityResponse,dataHealthResponse,r2Response,auditResponse,operationsResponse,workersResponse,materializationResponse,supervisorResponse]=await Promise.all([
      fetch("/api/storage/integrity?limit=100",{cache:"no-store"}),
      fetch("/api/data-health",{cache:"no-store"}),
      fetch("/api/storage/r2?limit=50&prefix=assets/",{cache:"no-store"}),
      fetch("/api/storage/audit",{cache:"no-store"}),
      fetch("/api/operations?limit=25",{cache:"no-store"}),
      fetch("/api/workers/health",{cache:"no-store"}),
      fetch("/api/materialization/stats",{cache:"no-store"}),
      fetch("/api/supervisor/panel",{cache:"no-store"}),
    ]);
    if(integrityResponse.ok)setIntegrity(await integrityResponse.json());
    if(dataHealthResponse.ok)setDataHealth(await dataHealthResponse.json());
    if(r2Response.ok){const value=await r2Response.json();setR2Objects(Array.isArray(value.objects)?value.objects:[]);}
    if(auditResponse.ok){const value=await auditResponse.json();setStorageAudit((value.audit?.summary || value.audit || null) as StorageAudit|null);}
    if(operationsResponse.ok){const value=await operationsResponse.json();setRecentOperations(Array.isArray(value.items)?value.items:[]);}
    if(workersResponse.ok)setDispatcherHealth(await workersResponse.json());
    if(materializationResponse.ok)setMaterializationStats(await materializationResponse.json());
    if(supervisorResponse.ok)setSupervisorPanel(await supervisorResponse.json());
  },[]);

  const runStorageAudit = useCallback(async () => {
    setAuditBusy(true);
    try {
      const response=await fetch("/api/storage/audit?maxObjects=10000",{method:"POST"});
      if(response.ok)setStorageAudit(await response.json());
    } finally { setAuditBusy(false); }
  },[]);

  const projectAction = useCallback(async (projectId:string, action:"process"|"reconcile") => {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/${action}`,{method:"POST"});
    await refreshRecords("Projetos");
  },[refreshRecords]);

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
    if (active === "Políticas") void refreshPolicies();
    if (active === "Estoque & giro") void refreshStock();
    if (active === "Configurações") void refreshSettings();
  }, [active, refreshCandidates, refreshRecords, refreshOperations, refreshPolicies, refreshStock, refreshSettings]);

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

  async function uploadDirectMedia() {
    if (!directFile) { setDirectMessage("Selecione um arquivo."); return; }
    setDirectBusy(true); setDirectMessage("");
    try {
      const prepare=await fetch("/api/uploads/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileName:directFile.name,mimeType:directFile.type||"application/octet-stream",maxBytes:Math.max(directFile.size,1024),universe:pushUniverse||undefined,subject:pushSubject||undefined,tags:["direct-upload"]})});
      const ticket=await prepare.json(); if(!prepare.ok)throw new Error(ticket.error||"PREPARE_FAILED");
      const upload=await fetch(ticket.uploadUrl,{method:"PUT",headers:{"content-type":directFile.type||"application/octet-stream"},body:directFile}); if(!upload.ok)throw new Error(`UPLOAD_${upload.status}`);
      const confirm=await fetch(`/api/uploads/${encodeURIComponent(ticket.uploadId)}/confirm`,{method:"POST"}); const result=await confirm.json(); if(!confirm.ok)throw new Error(result.error||"CONFIRM_FAILED");
      setDirectMessage(`Materializado: ${result.candidateId || result.projectFileId || ticket.uploadId}`); setDirectFile(null);
      if(active==="Inbox candidatas")await refreshCandidates();
    } catch(error) { setDirectMessage(error instanceof Error?error.message:"UPLOAD_FAILED"); }
    finally { setDirectBusy(false); }
  }

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

  function openInfrastructureSetup(edit = false) {
    setInfraMessage("");
    setInfraEditing(edit || !infraProfile);
    if (infraProfile) setInfraDraft({bffProjectName:infraProfile.bffProjectName,workerName:infraProfile.workerName,d1DatabaseName:infraProfile.d1DatabaseName,r2BucketName:infraProfile.r2BucketName,queueName:infraProfile.queueName,dlqName:infraProfile.dlqName});
    setSetupOpen(true);
  }

  function updateInfraDraft(field:keyof InfrastructureDraft,value:string){setInfraDraft(current=>({...current,[field]:value}));}

  async function saveInfrastructureProfile() {
    setInfraSaving(true); setInfraMessage("");
    try {
      const method=infraProfile?"PATCH":"POST";
      const body=infraProfile?{...infraDraft,expectedRevision:infraProfile.revision,confirmChange:true}:infraDraft;
      const response=await fetch("/api/infrastructure/config",{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const value=await response.json();
      if(!response.ok){setInfraMessage(value.error||`HTTP_${response.status}`);return;}
      setInfraEditing(false);
      setInfraMessage(infraProfile?`Alteração salva como revisão ${value.profile?.revision||"nova"}.`:`Configuração cravada na revisão ${value.profile?.revision||1}.`);
      await Promise.all([refreshSettings(),refreshHealth()]);
    } finally { setInfraSaving(false); }
  }

  async function recheckInfrastructure() {
    setSetupBusy(true); setInfraMessage("");
    try {
      if(infraProfile){
        const response=await fetch("/api/infrastructure/verify",{method:"POST"});
        const value=await response.json();
        setInfraMessage(response.ok?(value.healthy?"Infraestrutura verificada e saudável.":"Configuração preservada, mas algum binding não respondeu."):(value.error||`HTTP_${response.status}`));
      }
      await Promise.all([refreshHealth(), refreshSettings()]);
    } finally {
      setSetupBusy(false);
    }
  }

  async function copyInfrastructureChecklist() {
    const checklist = `CORVO LIBRARY V2 — CONFIGURAÇÃO DE INFRAESTRUTURA

VERCEL
CORVO_CORE_URL=https://<worker>.workers.dev
CORVO_INTERNAL_KEY=<mesma chave configurada no Worker>

CLOUDFLARE WORKER — BINDINGS
DB=D1 da Corvo Library
MEDIA=R2 bucket corvoquiz-prod
MATERIALIZE_QUEUE=Queue FAST PUSH
MATERIALIZE_DLQ=Dead Letter Queue

CLOUDFLARE WORKER — SECRETS
CORVO_INTERNAL_KEY=<chave compartilhada apenas com o BFF/MCP>
CORVO_SIGNING_KEY=<chave exclusiva do Worker para URLs temporárias>

Depois de configurar, volte à Library e clique em VERIFICAR AGORA.`;
    try {
      await navigator.clipboard.writeText(checklist);
      setSetupCopied(true);
      setTimeout(() => setSetupCopied(false), 1800);
    } catch {
      setSetupCopied(false);
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
        <div className="envBadge">V2 CORE 0.10</div>
      </header>

      <div className="content">
        <div className="titleRow"><div><h1>{active}</h1><p>{active === "Catálogo" ? "Sem conversão permanente: D1 estrutura, R2 armazena e o Worker materializa." : active === "Configurações" ? "Configuração persistente por bindings; atualização de código nunca redefine a infraestrutura." : "Reimplementação limpa por equivalência funcional."}</p></div>{active === "Configurações" && <button className="setupButton" onClick={() => openInfrastructureSetup(Boolean(infraProfile))}>⚙ {infraProfile ? "Alterar configuração" : "Configurar infraestrutura"}</button>}</div>

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
            <label className="searchBox"><span>⌕</span><input value={query} onChange={(e: ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)} placeholder="Buscar nome, universo, personagem ou tag..." /></label>
            <select value={universe} onChange={(e: ChangeEvent<HTMLSelectElement>)=>setUniverse(e.target.value)}><option value="">Todos os universos</option>{universes.map(item => <option key={item.name} value={item.name}>{item.name} ({item.total})</option>)}</select>
            <select value={status} onChange={(e: ChangeEvent<HTMLSelectElement>)=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="APPROVED">Aprovados</option><option value="PENDING">Pendentes</option><option value="REJECTED">Rejeitados</option></select>
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
          <div><span className="eyebrow">PROJETOS AUTOMÁTICOS</span><h2>Control plane preservado</h2><p>A V2 lê e cria projetos sobre <code>automatic_projects</code> sem reconciliação implícita ou varredura R2.</p><form className="pushForm" onSubmit={createProject}><input value={projectName} onChange={(e: ChangeEvent<HTMLInputElement>)=>setProjectName(e.target.value)} placeholder="Nome do projeto"/><button className="primary">Criar projeto</button></form></div>
          <div className="recordList">{recordLoading?<div className="quiet">Carregando…</div>:projects.length===0?<div className="quiet">Nenhum projeto.</div>:projects.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.pipeline_status || item.status} · {item.approved_count||0}/{item.total_items||0} aprovados</span></div><div className="inlineActions"><code>{item.id}</code><button onClick={()=>void projectAction(item.id,"reconcile")}>Reconciliar</button><button onClick={()=>void projectAction(item.id,"process")}>Processar</button></div></article>)}</div>
        </section>}

        {active === "Solicitações" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">SOLICITAÇÕES</span><h2>Fila estrutural preservada</h2><p>Cria e lê diretamente a tabela histórica <code>requests</code>.</p>
            <form className="pushForm" onSubmit={createLibraryRequest}><input value={requestProject} onChange={(e: ChangeEvent<HTMLInputElement>)=>setRequestProject(e.target.value)} placeholder="Projeto"/><textarea rows={8} value={requestItems} onChange={(e: ChangeEvent<HTMLTextAreaElement>)=>setRequestItems(e.target.value)} placeholder="Um item por linha"/><button className="primary">Criar solicitação</button></form>
          </div>
          <div className="recordList">{recordLoading ? <div className="quiet">Carregando…</div> : requests.length===0 ? <div className="quiet">Nenhuma solicitação.</div> : requests.map(item=><article key={item.id}><div><strong>{item.project}</strong><span>{item.item_count} itens · {item.status}</span></div><code>{item.id}</code></article>)}</div>
        </section>}

        {active === "Lotes" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">LOTES</span><h2>Lotes sobre o D1 histórico</h2><p>Manifestos novos são gravados diretamente no R2 via binding.</p>
            <form className="pushForm" onSubmit={createLibraryBatch}><input value={batchName} onChange={(e: ChangeEvent<HTMLInputElement>)=>setBatchName(e.target.value)} placeholder="Nome do lote"/><input value={batchProject} onChange={(e: ChangeEvent<HTMLInputElement>)=>setBatchProject(e.target.value)} placeholder="Projeto opcional"/><button className="primary">Criar lote</button></form>
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
              <textarea rows={10} value={pushUrls} onChange={(e: ChangeEvent<HTMLTextAreaElement>)=>setPushUrls(e.target.value)} placeholder={"Uma URL por linha\nhttps://.../imagem1.jpg\nhttps://.../imagem2.png"}/>
              <div className="formRow"><input value={pushUniverse} onChange={(e: ChangeEvent<HTMLInputElement>)=>setPushUniverse(e.target.value)} placeholder="Universo opcional"/><input value={pushSubject} onChange={(e: ChangeEvent<HTMLInputElement>)=>setPushSubject(e.target.value)} placeholder="Personagem/assunto opcional"/></div>
              {pushError && <div className="formError">{pushError}</div>}
              <button className="primary" disabled={pushBusy}>{pushBusy ? "Enviando…" : "Enviar para FAST PUSH"}</button>
            </form>
            <div className="directUploadBox"><span className="eyebrow">UPLOAD DIRETO</span><strong>Arquivo local → Worker → R2</strong><p>O navegador recebe um ticket temporário e envia o arquivo direto para o Core. Nenhuma Access Key aparece na Library e o MCP não manipula o binário.</p><input type="file" accept="image/*,video/*" onChange={(e: ChangeEvent<HTMLInputElement>)=>setDirectFile(e.target.files?.[0]||null)}/><div className="inlineActions"><button className="primary" type="button" disabled={!directFile||directBusy} onClick={()=>void uploadDirectMedia()}>{directBusy?"Enviando…":"Enviar arquivo"}</button>{directFile&&<code>{directFile.name} · {formatBytes(directFile.size)}</code>}</div>{directMessage&&<div className={directMessage.startsWith("Materializado")?"notice compact":"formError"}>{directMessage}</div>}</div>
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
          <section className="candidateToolbar"><div><b>Inbox de materialização</b><span>Aprovar move o objeto de incoming/ para assets/ e cria o AST-* no D1 histórico.</span></div><select value={candidateState} onChange={(e: ChangeEvent<HTMLSelectElement>)=>setCandidateState(e.target.value)}><option value="MATERIALIZED">Materializadas</option><option value="RETRYING">Em retry</option><option value="FAILED">Falhas</option><option value="APPROVED">Aprovadas</option><option value="REJECTED">Rejeitadas</option></select></section>
          {candidateLoading ? <div className="empty">Carregando candidatas…</div> : candidates.length === 0 ? <div className="empty"><strong>Inbox vazia</strong><span>As mídias do FAST PUSH aparecem aqui depois que a Queue conclui a materialização.</span></div> : <div className="candidateGrid">{candidates.map(candidate => <article className="candidate" key={candidate.id}>
            <div className="candidatePreview">{candidate.previewUrl ? <img src={candidate.previewUrl} alt=""/> : <span>{candidate.status}</span>}</div>
            <div className="candidateBody"><div className="candidateTitle"><strong>{candidate.subject || "Sem assunto"}</strong><b className={statusClass(candidate.status)}>{candidate.status}</b></div><span>{candidate.universe || "Sem universo"}</span><code>{candidate.id}</code><small>{formatBytes(candidate.sizeBytes)} · tentativa {candidate.attempts}</small>{candidate.failureReason && <p>{candidate.failureReason}</p>}
              {candidate.status === "MATERIALIZED" && <div className="decisionRow"><button className="approve" onClick={() => void decideCandidate(candidate.id,"approve")}>Aprovar</button><button className="reject" onClick={() => void decideCandidate(candidate.id,"reject")}>Rejeitar</button></div>}
            </div>
          </article>)}</div>}
        </>}

        {active === "Operação" && <section className="modulePanel operationGrid">
          <div><span className="eyebrow">INTEGRIDADE RÁPIDA</span><h2>D1 ↔ R2</h2><p>A amostra valida os <code>r2_key</code> mais recentes sem alterar qualquer registro.</p><div className="opNumbers"><span><b>{integrity?.checked ?? 0}</b>checados</span><span><b>{integrity?.present ?? 0}</b>presentes</span><span><b>{integrity?.missing ?? 0}</b>faltantes</span></div>{integrity?.missing ? <div className="formError">{integrity.missing} referências sem objeto na amostra.</div> : <div className="notice compact"><strong>Amostra limpa</strong><span>Nenhum objeto faltante na checagem rápida.</span></div>}</div>
          <div><span className="eyebrow">AUDITORIA COMPLETA</span><h2>Todas as referências conhecidas</h2><p>Compara assets, arquivos de projeto, imports, exports e materializações com o inventário físico do R2.</p><div className="opNumbers"><span><b>{storageAudit?.r2Objects ?? 0}</b>objetos R2</span><span><b>{storageAudit?.missingReferences ?? 0}</b>faltantes</span><span><b>{storageAudit?.orphanObjects ?? 0}</b>órfãos</span><span><b>{storageAudit?.sharedKeys ?? 0}</b>chaves compartilhadas</span></div><button className="primary" disabled={auditBusy} onClick={()=>void runStorageAudit()}>{auditBusy?"Auditando…":"Executar auditoria completa"}</button></div>
          <div><span className="eyebrow">INTEGRIDADE LÓGICA D1</span><h2>Histórico separado da V2</h2><p>Orfandades antigas permanecem auditáveis, mas o dispatcher novo não as assume. Regressões <code>v2_*</code> são tratadas separadamente.</p><div className="opNumbers"><span><b>{dataHealth?.v2Orphans ?? 0}</b>órfãos V2</span><span><b>{dataHealth?.activeHistoricalOrphans ?? 0}</b>históricos ativos</span><span><b>{dataHealth?.catalog.assetsMissingR2Key ?? 0}</b>assets sem r2_key</span><span><b>{dataHealth?.catalog.duplicateAssetR2Keys ?? 0}</b>r2_key compartilhadas</span></div><div className={(dataHealth?.v2Orphans||0)>0?"formError":"notice compact"}><strong>{(dataHealth?.v2Orphans||0)>0?"Regressão V2 detectada":"Camada V2 consistente"}</strong><span>{dataHealth?.activeHistoricalOrphans ? "Há filas históricas órfãs preservadas; elas são ignoradas pelo dispatcher V2." : "Nenhuma inconsistência ativa detectada."}</span></div></div>
          <div><span className="eyebrow">DISPATCHER</span><h2>Workers e leases</h2><div className="opNumbers"><span><b>{dispatcherHealth?.expiredLeases ?? 0}</b>leases expirados</span><span><b>{dispatcherHealth?.queue?.length ?? 0}</b>grupos de fila</span><span><b>{dispatcherHealth?.sessions?.length ?? 0}</b>grupos de sessões</span></div><div className={dispatcherHealth?.ok===false?"formError":"notice compact"}><strong>{dispatcherHealth?.ok===false?"Atenção":"Dispatcher saudável"}</strong><span>Leases expirados voltam para READY pelo watchdog, sem perder o item.</span></div></div>
          <div><span className="eyebrow">MATERIALIZAÇÃO</span><h2>FAST PUSH</h2><div className="recordList">{(materializationStats?.candidateStates||[]).length===0?<div className="quiet">Sem estatísticas.</div>:(materializationStats?.candidateStates||[]).map((item,index)=><article key={`${String(item.status)}-${index}`}><div><strong>{String(item.status)}</strong><span>{Number(item.bytes||0)>0?formatBytes(Number(item.bytes)):""}</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">OPERAÇÕES RECENTES</span><h2>Fila assíncrona</h2><div className="recordList">{recentOperations.length===0?<div className="quiet">Nenhuma operação.</div>:recentOperations.map(item=><article key={String(item.id)}><div><strong>{String(item.type||"OP")}</strong><span>{String(item.status||"")} · {String(item.succeeded||0)}/{String(item.requested||0)}</span></div><code>{String(item.id)}</code></article>)}</div></div>
          <div><span className="eyebrow">R2 — assets/</span><h2>Inventário recente</h2><div className="recordList">{r2Objects.length===0?<div className="quiet">Nenhum objeto carregado ou Core ainda desconectado.</div>:r2Objects.map(item=><article key={item.key}><div><strong>{item.key.split("/").pop()}</strong><span>{formatBytes(item.size)}</span></div><code>{item.key}</code></article>)}</div></div>
        </section>}

        {active === "Políticas" && <section className="modulePanel operationGrid">
          <div><span className="eyebrow">APRENDIZADO OPERACIONAL</span><h2>Gaps</h2><p>Os gaps são deduplicados por assinatura e permanecem auditáveis.</p><div className="recordList">{(policyWorkspace?.gaps||[]).length===0?<div className="quiet">Nenhum gap registrado.</div>:(policyWorkspace?.gaps||[]).map((item,index)=><article key={`${String(item.status)}-${String(item.category)}-${index}`}><div><strong>{String(item.category||"GAP")}</strong><span>{String(item.severity||"")} · {String(item.status||"")}</span></div><code>{String(item.count||item.occurrence_count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">POLÍTICAS</span><h2>Versões e estado</h2><p>Alterações criam novas versões; rollback não apaga histórico.</p><div className="recordList">{(policyWorkspace?.policies||[]).length===0?<div className="quiet">Nenhuma política registrada.</div>:(policyWorkspace?.policies||[]).map((item,index)=><article key={`${String(item.status)}-${String(item.category)}-${index}`}><div><strong>{String(item.category||"POLICY")}</strong><span>{String(item.status||"")} · {String(item.applied||0)} aplicações</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">TELEMETRIA</span><h2>Aplicações e resultados</h2><div className="recordList">{(policyTelemetry?.events||[]).length===0?<div className="quiet">Sem eventos de política.</div>:(policyTelemetry?.events||[]).map((item,index)=><article key={`${String(item.event_type)}-${index}`}><div><strong>{String(item.event_type||"EVENT")}</strong><span>{String(item.successes||"")}</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
        </section>}

        {active === "Estoque & giro" && <section className="modulePanel operationGrid"><div><span className="eyebrow">ESTOQUE</span><h2>{stats.approved.toLocaleString("pt-BR")} aprovados em {stats.universes.toLocaleString("pt-BR")} universos ativos</h2><p>Derivado diretamente da tabela histórica <code>assets</code>, sem conversão.</p><div className="recordList wide">{universes.slice(0,40).map(item=><article key={item.name}><div><strong>{item.name}</strong><span>{item.approved} aprovados · {item.pending} pendentes · {item.rejected} rejeitados</span></div><code>{item.total} total</code></article>)}</div></div><div><span className="eyebrow">GIRO</span><h2>Uso do catálogo</h2><div className="recordList">{(stockDetail?.rotation||[]).map((item,index)=><article key={`${String(item.bucket)}-${index}`}><div><strong>{String(item.bucket)}</strong><span>assets aprovados</span></div><code>{String(item.count||0)}</code></article>)}</div></div><div><span className="eyebrow">POLÍTICAS DE ESTOQUE</span><h2>Limites semânticos</h2><div className="recordList">{(stockDetail?.policies||[]).length===0?<div className="quiet">Nenhuma política ativa.</div>:(stockDetail?.policies||[]).slice(0,50).map((item,index)=><article key={`${String(item.id)}-${index}`}><div><strong>{String(item.concept||"conceito")}</strong><span>{String(item.universe||"Sem universo")} · min {String(item.minimum||0)} / ideal {String(item.ideal||0)}</span></div><code>{String(item.maximum||0)} max</code></article>)}</div></div></section>}

        {active === "Configurações" && <section className="modulePanel configPanel">
          <span className="eyebrow">INFRAESTRUTURA</span><h2>Configuração cravada por padrão</h2><p>Bindings e secrets ficam persistidos no Cloudflare/Vercel. O D1 guarda apenas o manifesto não secreto e sua revisão; deploys só leem, nunca resetam.</p>
          <div className="setupCallout"><div><strong>{infraProfile ? `Configuração travada · revisão ${infraProfile.revision}` : health?.core.ok ? "Core conectado — falta cravar o manifesto" : "Configuração ainda não concluída"}</strong><span>{infraProfile ? `Instância ${infraProfile.instanceId} · só muda pelo botão Alterar configuração.` : "Configure os bindings, conecte o Core e salve o manifesto uma única vez."}</span></div><button className="primary" onClick={() => openInfrastructureSetup(false)}>{infraProfile ? "Ver configuração" : "Configurar agora"}</button></div>
          {infraProfile && <div className="lockedConfig"><div><span>ESTADO</span><strong>🔒 LOCKED</strong></div><div><span>INSTÂNCIA</span><code>{infraProfile.instanceId}</code></div><div><span>REVISÃO</span><strong>{infraProfile.revision}</strong></div><div><span>ÚLTIMA ALTERAÇÃO</span><strong>{new Date(infraProfile.updatedAt).toLocaleString("pt-BR")}</strong></div></div>}
          <div className="bindingList"><div><b>DB</b><span>D1 · {infraProfile?.d1DatabaseName || "catálogo e estados históricos"}</span><em>{health?.core.d1 || "aguardando"}</em></div><div><b>MEDIA</b><span>R2 · {infraProfile?.r2BucketName || "corvoquiz-prod"}</span><em>{health?.core.r2 || "aguardando"}</em></div><div><b>MATERIALIZE_QUEUE</b><span>Queue · {infraProfile?.queueName || "FAST PUSH"}</span><em>{health?.core.queue || "aguardando"}</em></div><div><b>CORVO_INTERNAL_KEY</b><span>Persistida no Vercel/Worker; nunca no D1</span><em>{health?.coreConfigured ? "configurado" : "aguardando"}</em></div><div><b>CORVO_SIGNING_KEY</b><span>Persistida apenas no Worker</span><em>{health?.core.signing || "aguardando"}</em></div></div>
          <div className="notice compact"><strong>Regra de persistência</strong><span>Atualizar/reabrir = preservar · alterar = somente por ação explícita · credenciais R2 no D1: {String(bindingStatus?.r2CredentialsStoredInD1??false)}</span></div>
          {infraEvents.length>0 && <div className="recordList wide">{infraEvents.slice(0,8).map((item,index)=><article key={`${String(item.id)}-${index}`}><div><strong>{String(item.event_type||"EVENT")}</strong><span>revisão {String(item.next_revision||"")} · {new Date(Number(item.created_at||0)).toLocaleString("pt-BR")}</span></div><code>{String(item.source||"")}</code></article>)}</div>}
          <div className="recordList wide">{safeSettings.slice(0,60).map(item=><article key={item.key}><div><strong>{item.key}</strong><span>setting operacional persistente</span></div><code>{item.value}</code></article>)}</div>
        </section>}

        {!["Catálogo","Projetos","Solicitações","Lotes","Importações","Coleta automática","Operação","Políticas","Estoque & giro","Inbox candidatas","Pendentes","Rejeitados","Configurações"].includes(active) && <div className="modulePlaceholder"><strong>{active}</strong><p>Este módulo está na matriz de equivalência da V61.9. Ele será ligado ao núcleo V2 sem copiar bootstrap, recovery ou configuração legada.</p><span>EM DESENVOLVIMENTO CONTÍNUO</span></div>}

        {setupOpen && <div className="setupOverlay" role="dialog" aria-modal="true" aria-label="Configurar infraestrutura">
          <div className="setupModal">
            <div className="setupModalHead"><div><span className="eyebrow">ASSISTENTE DE INFRAESTRUTURA</span><h2>{infraProfile ? "Infraestrutura persistente" : "Conectar Corvo Core"}</h2><p>{infraProfile ? `Configuração cravada na revisão ${infraProfile.revision}. Abrir o app ou publicar uma atualização não altera estes valores.` : "Configure uma vez e salve. O manifesto não secreto fica no D1 e os secrets/bindings permanecem no Cloudflare/Vercel."}</p></div><button className="iconClose" onClick={() => {setSetupOpen(false);setInfraEditing(false);setInfraMessage("");}} aria-label="Fechar">×</button></div>

            <div className="setupProgress">
              <div className={health?.coreConfigured ? "done" : "current"}><b>1</b><span>Vercel BFF</span></div>
              <div className={health?.core.d1 === "ok" ? "done" : "current"}><b>2</b><span>D1</span></div>
              <div className={health?.core.r2 === "ok" ? "done" : "current"}><b>3</b><span>R2</span></div>
              <div className={health?.core.queue === "ok" ? "done" : "current"}><b>4</b><span>Queue</span></div>
              <div className={health?.core.ok ? "done" : "current"}><b>5</b><span>Teste</span></div>
            </div>

            <div className="persistBox">
              <div className="persistHead"><div><span>MANIFESTO PERSISTENTE</span><strong>{infraProfile ? `🔒 LOCKED · REV ${infraProfile.revision}` : "NÃO INICIALIZADO"}</strong></div>{infraProfile && !infraEditing && <button className="secondary" onClick={() => setInfraEditing(true)}>Alterar configuração</button>}</div>
              <div className="infraFields">
                {([
                  ["bffProjectName","Projeto Vercel"],["workerName","Worker"],["d1DatabaseName","D1"],["r2BucketName","R2 bucket"],["queueName","Queue"],["dlqName","DLQ"]
                ] as Array<[keyof InfrastructureDraft,string]>).map(([field,label])=><label key={field}><span>{label}</span>{infraEditing || !infraProfile ? <input value={infraDraft[field]} onChange={(event:ChangeEvent<HTMLInputElement>)=>updateInfraDraft(field,event.target.value)} /> : <code>{infraDraft[field]}</code>}</label>)}
              </div>
              {(infraEditing || !infraProfile) && <div className="persistActions"><span>Esses valores só mudam quando você salvar explicitamente. Secrets não entram aqui.</span>{infraProfile && <button className="secondary" onClick={()=>{setInfraEditing(false);setInfraDraft({bffProjectName:infraProfile.bffProjectName,workerName:infraProfile.workerName,d1DatabaseName:infraProfile.d1DatabaseName,r2BucketName:infraProfile.r2BucketName,queueName:infraProfile.queueName,dlqName:infraProfile.dlqName});setInfraMessage("");}}>Cancelar</button>}<button className="primary" disabled={infraSaving || !health?.coreConfigured} onClick={saveInfrastructureProfile}>{infraSaving ? "Salvando…" : infraProfile ? "Salvar nova revisão" : "Salvar e travar configuração"}</button></div>}
              {infraMessage && <div className="infraMessage">{infraMessage}</div>}
            </div>

            <div className="setupSteps">
              <article><header><b>1. Vercel</b><em className={health?.coreConfigured ? "okState" : "waitState"}>{health?.coreConfigured ? "CONFIGURADO" : "PENDENTE"}</em></header><p>No projeto <strong>corvo-library-v2</strong>, adicione:</p><code>CORVO_CORE_URL=https://&lt;worker&gt;.workers.dev</code><code>CORVO_INTERNAL_KEY=&lt;chave-compartilhada&gt;</code></article>
              <article><header><b>2. Cloudflare Worker</b><em className={health?.core.signing === "ok" ? "okState" : "waitState"}>{health?.core.signing === "ok" ? "CONFIGURADO" : "PENDENTE"}</em></header><p>Configure secrets somente no Worker:</p><code>CORVO_INTERNAL_KEY=&lt;mesma-chave-do-BFF&gt;</code><code>CORVO_SIGNING_KEY=&lt;chave-exclusiva-do-worker&gt;</code></article>
              <article><header><b>3. Bindings nativos</b><em className={health?.core.d1 === "ok" && health?.core.r2 === "ok" && health?.core.queue === "ok" ? "okState" : "waitState"}>{health?.core.d1 === "ok" && health?.core.r2 === "ok" && health?.core.queue === "ok" ? "OK" : "PENDENTE"}</em></header><div className="miniBindings"><span><b>DB</b>D1 Corvo Library · {health?.core.d1 || "unknown"}</span><span><b>MEDIA</b>R2 corvoquiz-prod · {health?.core.r2 || "unknown"}</span><span><b>MATERIALIZE_QUEUE</b>FAST PUSH · {health?.core.queue || "unknown"}</span><span><b>MATERIALIZE_DLQ</b>fila de falhas</span></div></article>
              <article><header><b>4. Banco</b><em className={health?.core.schema === "ok" ? "okState" : "waitState"}>{health?.core.schema === "ok" ? "SCHEMA OK" : "AGUARDANDO"}</em></header><p>Restaure a base histórica uma única vez e aplique as migrations <code>v2_*</code>. Depois disso os deploys não recriam nem convertem o catálogo.</p></article>
            </div>

            <div className="setupResult"><div><span>ESTADO ATUAL</span><strong className={health?.core.ok && infraProfile ? "okState" : "waitState"}>{health?.core.ok && infraProfile ? "CONFIGURAÇÃO CRAVADA E ONLINE" : health?.core.ok ? "CORE ONLINE · SALVE O MANIFESTO" : coreState}</strong><small>{health?.core.error || (infraProfile ? `Instância ${infraProfile.instanceId} · revisão ${infraProfile.revision}` : "Finalize os passos e salve a configuração uma única vez.")}</small></div><div className="setupActions"><button className="secondary" onClick={copyInfrastructureChecklist}>{setupCopied ? "✓ Copiado" : "Copiar checklist"}</button><button className="primary" disabled={setupBusy || !infraProfile} onClick={recheckInfrastructure}>{setupBusy ? "Verificando…" : "Verificar agora"}</button></div></div>
          </div>
        </div>}

      </div>
    </section>
  </main>;
}
