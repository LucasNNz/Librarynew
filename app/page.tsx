"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Asset, AutomaticProject, Batch, Candidate, CatalogResponse, CatalogStats, DispatcherHealth, ImportRecord, LibraryRequest, MaterializationStats, Operation, StorageAudit, R2Explorer, PendingR2Reconcile, R2CatalogSync, UniverseFacet } from "../lib/contracts";
import { clearBrowserConnection, installCorvoFetchBridge, readBrowserConnection, saveBrowserConnection, type BrowserConnection } from "../lib/browser-connection";

type Health = {
  app: "ok";
  architecture: "CLOUDFLARE_CORE";
  coreConfigured: boolean;
  core: { ok: boolean; version?: string; d1?: string; r2?: string; schema?: string; queue?: string; signing?: string; appAuth?: string; control?: string; queueBacklog?: number | null; error?: string };
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

const primaryNav = [
  { id:"Visão geral", icon:"grid" as UiIconName, label:"Visão geral" },
  { id:"Assets", icon:"assets" as UiIconName, label:"Assets" },
  { id:"Projetos", icon:"folder" as UiIconName, label:"Projetos" },
  { id:"Execuções", icon:"play" as UiIconName, label:"Execuções" },
  { id:"Análise", icon:"chart" as UiIconName, label:"Análise" },
  { id:"Configurações", icon:"settings" as UiIconName, label:"Configurações" },
] as const;
const EXPECTED_CORE_VERSION = "0.20.2";
const MAX_IMPORT_ZIP_BYTES = 48 * 1024 * 1024;

type UiIconName = "grid"|"assets"|"folder"|"play"|"chart"|"settings"|"layers"|"pulse"|"target"|"activity"|"search"|"bell"|"download"|"brain"|"spark";

function UiIcon({name, size=20}:{name:UiIconName; size?:number}) {
  const common = { width:size, height:size, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:1.8, strokeLinecap:"round" as const, strokeLinejoin:"round" as const, "aria-hidden":true };
  const shapes: Record<UiIconName, React.ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    assets:<><path d="M4 5.5h16v13H4z"/><path d="m7 15 3-3 2.2 2.2 2.4-2.5L18 15"/><circle cx="8.2" cy="9" r="1.25"/></>,
    folder:<><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 8.5h17"/></>,
    play:<><circle cx="12" cy="12" r="9"/><path d="m10 8.7 5.2 3.3L10 15.3z"/></>,
    chart:<><path d="M5 20V9"/><path d="M10 20V4"/><path d="M15 20v-7"/><path d="M20 20V7"/><path d="M3 20h19"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05-2.78 2.78-.05-.05A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1.1 1.65V21h-3.8v-.05A1.8 1.8 0 0 0 9 19.4a1.8 1.8 0 0 0-1.98.36l-.05.05-2.78-2.78.05-.05A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.1H3v-3.8h.05A1.8 1.8 0 0 0 4.6 9a1.8 1.8 0 0 0-.36-1.98l-.05-.05 2.78-2.78.05.05A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1.1-1.65V3h3.8v.05A1.8 1.8 0 0 0 15 4.6a1.8 1.8 0 0 0 1.98-.36l.05-.05 2.78 2.78-.05.05A1.8 1.8 0 0 0 19.4 9a1.8 1.8 0 0 0 1.65 1.1H21v3.8h-.05A1.8 1.8 0 0 0 19.4 15Z"/></>,
    layers:<><path d="m12 3 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></>,
    pulse:<><path d="M3 12h4l2-6 4 12 2-6h6"/></>,
    target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M16.7 7.3 21 3"/><path d="M17.5 3H21v3.5"/></>,
    activity:<><path d="M3 12h4l2.2-5.5 4.2 11 2.2-5.5H21"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    download:<><path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/></>,
    brain:<><path d="M9.5 4.5A3 3 0 0 0 4 6.2 3.2 3.2 0 0 0 4.5 12 3.2 3.2 0 0 0 6 17.8 3 3 0 0 0 11.5 19V5.8a2.5 2.5 0 0 0-2-1.3Z"/><path d="M14.5 4.5A3 3 0 0 1 20 6.2a3.2 3.2 0 0 1-.5 5.8 3.2 3.2 0 0 1-1.5 5.8 3 3 0 0 1-5.5 1.2V5.8a2.5 2.5 0 0 1 2-1.3Z"/><path d="M8 9.5h3.5M12.5 13.5H16"/></>,
    spark:<><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8z"/><path d="m18.5 15 .7 2 2 .8-2 .7-.7 2-.8-2-2-.7 2-.8z"/></>,
  };
  return <svg {...common}>{shapes[name]}</svg>;
}

function Mark() {
  return <span className="markV18" aria-hidden="true"><svg viewBox="0 0 54 54"><path d="M38.8 5.5c-8.4.7-15.2 5.2-18 12.2l-9.1 5.2 8.1 2.6c.5 4.8 3.2 8.7 7.4 10.8L22 47h6.2l5.6-9.4c5.6-1.4 9.8-5.1 11.4-10.3-3.2 1.7-6.8 2.4-10.4 1.8 4.6-3.1 7.5-8.4 7.4-14.1 0-3.7-1.2-7-3.4-9.5Z"/><path d="M21.2 18.2c4.1-1.4 7.4-4.2 9.5-8.1"/><circle cx="31.2" cy="16.4" r="1.8"/></svg></span>;
}

function progressForProject(project: AutomaticProject) {
  const total = Number(project.total_items || 0);
  const approved = Number(project.approved_count || 0);
  return total ? Math.min(100, Math.round((approved / total) * 100)) : 0;
}

function AgentProjectNetwork({projects, pending, queueBacklog, online}:{projects:AutomaticProject[]; pending:number; queueBacklog:number; online:boolean}) {
  const visible = projects.slice(0,5);
  const slots = Array.from({length:5},(_,index)=>visible[index] || null);
  const agents = [
    {name:"Coletor", icon:"search" as UiIconName, tone:"violet", detail:"captura e descoberta"},
    {name:"Analista", icon:"target" as UiIconName, tone:"blue", detail:`${pending} decisões pendentes`},
    {name:"Roteirista", icon:"spark" as UiIconName, tone:"green", detail:"roteiros e requirements"},
    {name:"Exportador", icon:"download" as UiIconName, tone:"orange", detail:"ZIPs e pacotes"},
    {name:"Supervisor", icon:"brain" as UiIconName, tone:"purple", detail:"políticas via MCP"},
  ];
  const ys=[128,166,204,242,280];
  const projectXs=[380,545,710,875,1040];
  const colors=["#8d5cff","#418cff","#35d99b","#ff9b4d","#b35cff"];
  return <div className="agentNetwork">
    <svg className="networkWires" viewBox="0 0 1160 338" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="wireGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        {colors.map((color,index)=><linearGradient id={`wire-${index}`} key={color} x1="0" x2="1"><stop offset="0" stopColor={color} stopOpacity=".08"/><stop offset=".14" stopColor={color} stopOpacity=".8"/><stop offset=".9" stopColor={color} stopOpacity=".55"/><stop offset="1" stopColor={color} stopOpacity=".08"/></linearGradient>)}
      </defs>
      {ys.map((y,row)=><g key={y}>
        <path className="wirePath" d={`M 168 ${y} C 280 ${y-20}, 315 ${y+16}, 395 ${y} S 535 ${y-14}, 595 ${y} S 720 ${y+16}, 780 ${y} S 910 ${y-13}, 992 ${y} S 1080 ${y+10}, 1140 ${y}`} stroke={`url(#wire-${row})`} filter="url(#wireGlow)"/>
        {projectXs.map((x,index)=><circle key={x} cx={x} cy={y} r="3.8" fill={colors[row]} opacity={slots[index]?1:.25} filter="url(#wireGlow)"/>)}
      </g>)}
    </svg>
    <div className="networkLegend">
      {agents.map(agent=><div className={`networkAgent ${agent.tone}`} key={agent.name}><span><UiIcon name={agent.icon} size={16}/></span><div><strong>{agent.name}</strong><small>{agent.detail}</small></div><b>{online?"●":"○"}</b></div>)}
    </div>
    <div className="networkProjects">
      {slots.map((project,index)=>{
        const progress=project?progressForProject(project):0;
        return <div className={`networkProject ${project?"live":"idle"}`} key={project?.id || `slot-${index}`}>
          <div className="networkProjectHead"><strong>{project?.name || "Slot livre"}</strong><small>{project?String(project.pipeline_status||project.status||"ATIVO"):"Aguardando projeto"}</small></div>
          <div className={`progressRing p${Math.round(progress/10)*10}`} style={{"--progress":`${progress*3.6}deg`} as any}><span>{project?`${progress}%`:"—"}</span></div>
          <div className="projectWireNodes">{agents.map((agent,row)=><i key={agent.name} style={{"--node-color":colors[row]} as any}/>)}</div>
        </div>;
      })}
    </div>
    <div className="networkFooter"><span><i className={online?"live":""}/>Core {online?"online":"offline"}</span><span>Queue <b>{queueBacklog}</b></span><span>{projects.length} projeto(s) ativo(s)</span></div>
  </div>;
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
  const [active, setActive] = useState("Visão geral");
  const [assetView, setAssetView] = useState("Catálogo");
  const [projectView, setProjectView] = useState("Projetos");
  const [executionView, setExecutionView] = useState("Coleta automática");
  const [analysisView, setAnalysisView] = useState("Estoque & giro");
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<CatalogStats>({ total:0, approved:0, pending:0, rejected:0, universes:0, bytes:0, uses:0 });
  const [universes, setUniverses] = useState<UniverseFacet[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
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
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importProgress, setImportProgress] = useState<Array<{name:string;state:string;detail:string}>>([]);
  const [r2CatalogSync, setR2CatalogSync] = useState<R2CatalogSync | null>(null);
  const [r2SyncBusy, setR2SyncBusy] = useState(false);
  const [r2SyncMessage, setR2SyncMessage] = useState("");
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
  const [r2Explorer, setR2Explorer] = useState<R2Explorer | null>(null);
  const [r2ExploreBusy, setR2ExploreBusy] = useState(false);
  const [r2ExploreError, setR2ExploreError] = useState("");
  const [pendingR2, setPendingR2] = useState<PendingR2Reconcile | null>(null);
  const [pendingR2Busy, setPendingR2Busy] = useState(false);
  const [pendingR2RepairBusy, setPendingR2RepairBusy] = useState(false);
  const [pendingR2Message, setPendingR2Message] = useState("");
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
  const [setupAdvanced, setSetupAdvanced] = useState(false);
  const [infraProfile, setInfraProfile] = useState<InfrastructureProfile | null>(null);
  const [infraEvents, setInfraEvents] = useState<Array<Record<string,unknown>>>([]);
  const [infraEditing, setInfraEditing] = useState(false);
  const [infraDraft, setInfraDraft] = useState<InfrastructureDraft>(defaultInfrastructureDraft);
  const [infraMessage, setInfraMessage] = useState("");
  const [infraSaving, setInfraSaving] = useState(false);
  const [localConnection, setLocalConnection] = useState<BrowserConnection | null>(null);
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [cloudflareAccountId, setCloudflareAccountId] = useState("");
  const [cloudflareAccounts, setCloudflareAccounts] = useState<Array<{id:string;name:string}>>([]);
  const [autoSetupStage, setAutoSetupStage] = useState("");
  const [autoSetupBusy, setAutoSetupBusy] = useState(false);
  const [coreUpdateBusy, setCoreUpdateBusy] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpShowKey, setMcpShowKey] = useState(false);
  const [mcpCopied, setMcpCopied] = useState<""|"url"|"key"|"bundle">("");
  const [mcpRotateBusy, setMcpRotateBusy] = useState(false);
  const [mcpMessage, setMcpMessage] = useState("");

  const currentView = active === "Assets" ? assetView
    : active === "Projetos" ? projectView
    : active === "Execuções" ? executionView
    : active === "Análise" ? analysisView
    : active;

  const refreshHealth = useCallback(async () => {
    const response = await fetch("/api/health", { cache:"no-store" });
    const value = await response.json();
    if (value && value.app === "ok" && value.core) {
      setHealth(value as Health);
      return;
    }
    const connected = Boolean(readBrowserConnection());
    setHealth({ app:"ok", architecture:"CLOUDFLARE_CORE", coreConfigured:connected, core:{ ...value, ok:Boolean(value?.ok) } });
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

  const selectedAssetIds = useMemo(() => [...selectedAssets], [selectedAssets]);
  const selectedPendingCount = useMemo(() => assets.filter(asset => selectedAssets.has(asset.id) && asset.status === "PENDING").length, [assets, selectedAssets]);

  function toggleAssetSelection(assetId: string) {
    setSelectedAssets(current => { const next=new Set(current); next.has(assetId)?next.delete(assetId):next.add(assetId); return next; });
  }
  function selectLoadedAssets() { setSelectedAssets(new Set(assets.map(asset=>asset.id))); }
  function clearAssetSelection() { setSelectedAssets(new Set()); }

  async function bulkApproveAssets() {
    const ids=selectedAssetIds;
    if(!ids.length)return;
    setBulkBusy(true);setBulkMessage("");
    try{const response=await fetch("/api/assets/approve-pending",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assetIds:ids,note:"Aprovado em lote pela Corvo Library V2"})});const value=await response.json();if(!response.ok)throw new Error(value.error||`HTTP_${response.status}`);setBulkMessage(`${Number(value.approved||0)} asset(s) aprovado(s).`);clearAssetSelection();await Promise.all([refreshStats(),fetchCatalog(null,false)]);}catch(error){setBulkMessage(error instanceof Error?error.message:"BULK_APPROVE_FAILED");}finally{setBulkBusy(false);}
  }

  async function bulkDeleteAssets(idsInput?: string[], pendingOnly=false) {
    const ids=idsInput?.length?idsInput:selectedAssetIds;if(!ids.length)return;
    const ok=window.confirm(`Excluir permanentemente ${ids.length} registro(s)? Quando o arquivo existir e não for compartilhado, ele também será removido do bucket R2. Esta ação não tem desfazer.`);if(!ok)return;
    setBulkBusy(true);setBulkMessage("");
    try{const endpoint=pendingOnly?"/api/assets/pending/permanent-delete":"/api/assets/permanent-delete-batch";const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assetIds:ids,confirm:true})});const value=await response.json();if(!response.ok)throw new Error(value.error||`HTTP_${response.status}`);setBulkMessage(`${Number(value.deleted||0)} registro(s) removido(s) permanentemente.`);clearAssetSelection();setPendingR2(null);await Promise.all([refreshStats(),fetchCatalog(null,false)]);}catch(error){setBulkMessage(error instanceof Error?error.message:"BULK_DELETE_FAILED");}finally{setBulkBusy(false);}
  }

  async function deleteUnresolvedPending() {
    const expected=(pendingR2?.items||[]).filter(item=>item.state==="NOT_FOUND").length;
    if(!expected)return;
    const ok=window.confirm(`Refazer a varredura completa do R2 e excluir permanentemente apenas os Pendentes que continuarem NÃO ENCONTRADOS?\n\nEles serão removidos do D1 para recaptura limpa. Esta ação não tem desfazer.`);
    if(!ok)return;
    setBulkBusy(true);setBulkMessage("Refazendo varredura antes da exclusão…");
    try{
      const response=await fetch("/api/storage/r2/pending-reconcile/delete-missing",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirm:true,maxObjects:20000})});
      const value=await response.json();
      if(!response.ok)throw new Error(value.error||`HTTP_${response.status}`);
      setBulkMessage(`${Number(value.deleted||0)} Pendentes sem arquivo foram removidos. A política agora é recapturar mídia nova.`);
      clearAssetSelection();setPendingR2(null);
      await Promise.all([refreshStats(),fetchCatalog(null,false)]);
    }catch(error){setBulkMessage(error instanceof Error?error.message:"DELETE_MISSING_PENDING_FAILED");}
    finally{setBulkBusy(false);}
  }

  async function downloadSelectedZip() {
    const ids=selectedAssetIds;if(!ids.length)return;
    setBulkBusy(true);setBulkMessage("Gerando ZIP no R2…");
    try{const response=await fetch("/api/asset-exports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assetIds:ids,name:`corvo-${ids.length}-assets.zip`})});const queued=await response.json();if(!response.ok)throw new Error(queued.error||`HTTP_${response.status}`);const exportId=String(queued.export_id||queued.id||"");if(!exportId)throw new Error("EXPORT_ID_MISSING");for(let attempt=0;attempt<90;attempt+=1){const linkResponse=await fetch(`/api/asset-exports/${encodeURIComponent(exportId)}/link?ttlMinutes=30`,{cache:"no-store"});const value=await linkResponse.json();if(linkResponse.ok&&value.download_url){setBulkMessage(`ZIP pronto: ${formatBytes(Number(value.size_bytes||0))}. O download foi iniciado.`);window.location.assign(String(value.download_url));return;}if(linkResponse.status!==409)throw new Error(value.error||`EXPORT_LINK_HTTP_${linkResponse.status}`);await new Promise(resolve=>setTimeout(resolve,1000));}throw new Error("EXPORT_TIMEOUT");}catch(error){setBulkMessage(error instanceof Error?error.message:"EXPORT_FAILED");}finally{setBulkBusy(false);}
  }

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

  async function runR2CatalogSync(repair = true) {
    setR2SyncBusy(true);
    setR2SyncMessage(repair ? "Sincronizando catálogo com o R2…" : "Verificando R2…");
    try {
      const response = await fetch("/api/storage/sync-r2", {
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({repair,maxObjects:20000,maxRepairs:1000}),
      });
      const value = await response.json() as R2CatalogSync & {error?:string};
      if (!response.ok) throw new Error(value.error || `HTTP_${response.status}`);
      setR2CatalogSync(value);
      const state = value.missingInR2 === 0 && value.uncatalogedAfter === 0 ? "R2 e D1 sincronizados" : "Sincronização requer atenção";
      setR2SyncMessage(`${state}: ${value.repaired} reconstruído(s), ${value.uncatalogedAfter} sem catálogo, ${value.missingInR2} ausente(s) no R2.`);
      await refreshStats();
      return value;
    } catch (error) {
      setR2SyncMessage(error instanceof Error ? error.message : "R2_SYNC_FAILED");
      return null;
    } finally {
      setR2SyncBusy(false);
    }
  }

  async function importSelectedBatches() {
    if (!importFiles.length) { setImportMessage("Selecione um ou mais lotes ZIP."); return; }
    const oversized = importFiles.filter(file => file.size > MAX_IMPORT_ZIP_BYTES);
    if (oversized.length) {
      setImportMessage(`Lote acima de 48 MB: ${oversized.map(file=>file.name).join(", ")}. Use os lotes preparados para a V2.`);
      return;
    }
    setImportBusy(true);
    setImportMessage("");
    setImportProgress(importFiles.map(file => ({name:file.name,state:"AGUARDANDO",detail:formatBytes(file.size)})));
    let completed = 0;
    let failures = 0;
    for (let index = 0; index < importFiles.length; index++) {
      const file = importFiles[index];
      const update = (state:string, detail:string) => setImportProgress(current => current.map((item,position)=>position===index?{...item,state,detail}:item));
      try {
        update("PREPARANDO", "Criando upload direto para o R2");
        const prepare = await fetch("/api/imports/zip/prepare", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({fileName:file.name}) });
        const ticket = await prepare.json();
        if (!prepare.ok) throw new Error(ticket.error || `PREPARE_${prepare.status}`);
        update("ENVIANDO", `${formatBytes(file.size)} → R2`);
        const upload = await fetch(String(ticket.uploadUrl), { method:"PUT", headers:{"content-type":"application/zip"}, body:file });
        if (!upload.ok) throw new Error(`UPLOAD_${upload.status}`);
        update("CONFIRMANDO", "Registrando lote no D1");
        const confirm = await fetch(`/api/uploads/${encodeURIComponent(String(ticket.uploadId))}/confirm`, { method:"POST" });
        const confirmed = await confirm.json();
        if (!confirm.ok) throw new Error(confirmed.error || `CONFIRM_${confirm.status}`);
        const importId = String(confirmed.importId || "");
        if (!importId) throw new Error("IMPORT_ID_MISSING");
        update("PROCESSANDO", `${importId} · extraindo e catalogando`);
        const process = await fetch(`/api/imports/${encodeURIComponent(importId)}/process`, { method:"POST" });
        const result = await process.json();
        if (!process.ok) throw new Error(result.error || `PROCESS_${process.status}`);
        completed++;
        update("CONCLUÍDO", `${Number(result.assets_catalogados||0)} novos · ${Number(result.assets_atualizados||0)} atualizados · ${Number(result.aprovados||0)} catálogo · ${Number(result.pendentes||0)} pendentes`);
      } catch (error) {
        failures++;
        update("ERRO", error instanceof Error ? error.message : "IMPORT_FAILED");
      }
    }
    await Promise.all([refreshRecords("Importações"), refreshStats()]);
    const sync = await runR2CatalogSync(true);
    setImportMessage(`${completed}/${importFiles.length} lote(s) concluído(s)${failures?` · ${failures} falha(s)`:""}${sync?.ok?" · R2/D1 verificados":""}.`);
    if (!failures) setImportFiles([]);
    setImportBusy(false);
  }

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

  const exploreR2 = useCallback(async (prefix = "") => {
    setR2ExploreBusy(true);
    setR2ExploreError("");
    try {
      const params=new URLSearchParams({maxObjects:"50000"});
      if(prefix)params.set("prefix",prefix);
      const response=await fetch(`/api/storage/r2/explore?${params}`,{cache:"no-store"});
      const value=await response.json();
      if(!response.ok){setR2ExploreError(String(value?.error||"Falha ao vasculhar R2"));return;}
      setR2Explorer(value as R2Explorer);
    } catch(error) {
      setR2ExploreError(error instanceof Error?error.message:"Falha ao vasculhar R2");
    } finally { setR2ExploreBusy(false); }
  },[]);

  const scanPendingR2 = useCallback(async () => {
    setPendingR2Busy(true);
    setPendingR2Message("");
    try {
      const response=await fetch("/api/storage/r2/pending-reconcile?maxObjects=50000&limit=500",{cache:"no-store"});
      const value=await response.json();
      if(!response.ok){setPendingR2Message(String(value?.error||"Falha ao procurar os pendentes no R2"));return;}
      setPendingR2(value as PendingR2Reconcile);
    } catch(error) {
      setPendingR2Message(error instanceof Error?error.message:"Falha ao procurar os pendentes no R2");
    } finally { setPendingR2Busy(false); }
  },[]);

  const repairPendingR2 = useCallback(async () => {
    if(!pendingR2?.repairable)return;
    setPendingR2RepairBusy(true);
    setPendingR2Message("");
    try {
      const ids=pendingR2.items.filter(item=>item.state==="FOUND_ALTERNATE"&&item.bestMatch?.autoRepairable).map(item=>item.assetId);
      const response=await fetch("/api/storage/r2/pending-reconcile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assetIds:ids,maxObjects:50000})});
      const value=await response.json();
      if(!response.ok){setPendingR2Message(String(value?.error||"Falha ao religar os arquivos encontrados"));return;}
      setPendingR2Message(`${Number(value.repaired||0)} pendente(s) religado(s) ao arquivo físico. O status Pendente foi preservado.`);
      await Promise.all([scanPendingR2(),fetchCatalog(null,false),refreshStats()]);
    } catch(error) {
      setPendingR2Message(error instanceof Error?error.message:"Falha ao religar os arquivos encontrados");
    } finally { setPendingR2RepairBusy(false); }
  },[pendingR2,scanPendingR2,fetchCatalog,refreshStats]);

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
    const dispose = installCorvoFetchBridge();
    setLocalConnection(readBrowserConnection());
    return dispose;
  }, []);

  useEffect(() => {
    void Promise.all([refreshHealth(), refreshStats()]);
  }, [refreshHealth, refreshStats]);

  useEffect(() => {
    if (active !== "Assets" || assetView === "Importar & R2") return;
    const desired = assetView === "Catálogo" ? "APPROVED" : assetView === "Pendentes" ? "PENDING" : "REJECTED";
    if (status !== desired) setStatus(desired);
  }, [active, assetView, status]);

  useEffect(() => {
    if (active === "Assets" && assetView === "Importar & R2") return;
    const timer = setTimeout(() => void fetchCatalog(null, false), 280);
    return () => clearTimeout(timer);
  }, [active, assetView, fetchCatalog]);

  useEffect(() => {
    if (currentView === "Visão geral") {
      void Promise.all([refreshRecords("Projetos"), refreshOperations()]);
    }
    if (currentView === "Inbox candidatas") void refreshCandidates();
    if (["Projetos","Solicitações","Lotes","Importações"].includes(currentView)) void refreshRecords(currentView);
    if (currentView === "Importar & R2") void refreshRecords("Importações");
    if (currentView === "Operação") void refreshOperations();
    if (currentView === "Políticas") void refreshPolicies();
    if (currentView === "Estoque & giro") void refreshStock();
    if (currentView === "Configurações") void refreshSettings();
  }, [currentView, refreshCandidates, refreshRecords, refreshOperations, refreshPolicies, refreshStock, refreshSettings]);

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
  const activeProjects = useMemo(() => projects.filter(project => !["COMPLETED","DONE","CANCELLED","FAILED"].includes(String(project.pipeline_status || project.status || "").toUpperCase())), [projects]);
  const completedOps = useMemo(() => recentOperations.filter(item => ["COMPLETED","COMPLETED_WITH_ERRORS"].includes(String(item.status || "").toUpperCase())).length, [recentOperations]);
  const failedOps = useMemo(() => recentOperations.filter(item => String(item.status || "").toUpperCase() === "FAILED").length, [recentOperations]);
  const operationSuccessRate = completedOps + failedOps > 0 ? Math.round((completedOps / (completedOps + failedOps)) * 100) : 100;
  const activeWorkerCount = dispatcherHealth?.sessions?.length || 0;
  const pageDescription = active === "Visão geral" ? "A fábrica Corvo em um único painel: agentes, projetos, fila, assets e atividade recente."
    : active === "Assets" ? "Biblioteca visual com catálogo, revisão, importação em lotes e sincronização verificável com o R2."
    : active === "Projetos" ? "Projetos, solicitações, lotes e importações reunidos no mesmo fluxo de produção."
    : active === "Execuções" ? "Coleta, materialização, Inbox e operação em tempo real com heartbeat e Queue."
    : active === "Análise" ? "Estoque, giro, políticas e inteligência operacional da Library."
    : "Infraestrutura autossuficiente, persistente e protegida entre atualizações.";

  async function uploadDirectMedia() {
    if (!directFile) { setDirectMessage("Selecione um arquivo."); return; }
    setDirectBusy(true); setDirectMessage("");
    try {
      const prepare=await fetch("/api/uploads/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileName:directFile.name,mimeType:directFile.type||"application/octet-stream",maxBytes:Math.max(directFile.size,1024),universe:pushUniverse||undefined,subject:pushSubject||undefined,tags:["direct-upload"]})});
      const ticket=await prepare.json(); if(!prepare.ok)throw new Error(ticket.error||"PREPARE_FAILED");
      const upload=await fetch(ticket.uploadUrl,{method:"PUT",headers:{"content-type":directFile.type||"application/octet-stream"},body:directFile}); if(!upload.ok)throw new Error(`UPLOAD_${upload.status}`);
      const confirm=await fetch(`/api/uploads/${encodeURIComponent(ticket.uploadId)}/confirm`,{method:"POST"}); const result=await confirm.json(); if(!confirm.ok)throw new Error(result.error||"CONFIRM_FAILED");
      setDirectMessage(`Materializado: ${result.candidateId || result.projectFileId || ticket.uploadId}`); setDirectFile(null);
      if(currentView==="Inbox candidatas")await refreshCandidates();
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
    setSetupAdvanced(false);
    setCloudflareToken("");
    setCloudflareAccounts([]);
    setCloudflareAccountId(localConnection?.accountId || "");
    setAutoSetupStage("");
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

  async function runAutomaticSetup() {
    if (!cloudflareToken.trim()) { setInfraMessage("Cole o API Token da Cloudflare."); return; }
    setAutoSetupBusy(true); setInfraMessage("");
    try {
      setAutoSetupStage("Conectando à Cloudflare…");
      const provisionResponse = await fetch("/api/setup/cloudflare/provision", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({ apiToken:cloudflareToken.trim(), accountId:cloudflareAccountId || undefined, workerName:infraDraft.workerName, d1DatabaseName:infraDraft.d1DatabaseName, r2BucketName:infraDraft.r2BucketName, queueName:infraDraft.queueName, dlqName:infraDraft.dlqName }),
      });
      const provision = await provisionResponse.json();
      if (provisionResponse.status === 409 && provision.error === "ACCOUNT_SELECTION_REQUIRED") {
        setCloudflareAccounts(Array.isArray(provision.accounts) ? provision.accounts : []);
        setAutoSetupStage("Escolha a conta Cloudflare e continue.");
        return;
      }
      if (provisionResponse.status === 409 && provision.error === "ACCOUNT_ID_REQUIRED") {
        setAutoSetupStage("Informe o Account ID da sua conta Cloudflare e continue.");
        setInfraMessage("O token é válido para recursos da conta, mas a Cloudflare não permitiu listar automaticamente o Account ID. Copie o Account ID do painel Cloudflare e cole no campo abaixo.");
        return;
      }
      if (!provisionResponse.ok) throw new Error(provision.error || `PROVISION_HTTP_${provisionResponse.status}`);
      const connection = provision.connection as BrowserConnection;
      saveBrowserConnection(connection);
      setLocalConnection(connection);
      setCloudflareAccountId(connection.accountId);
      setInfraDraft({ bffProjectName:"corvo-library-v2", workerName:connection.workerName, d1DatabaseName:connection.d1DatabaseName, r2BucketName:connection.r2BucketName, queueName:connection.queueName, dlqName:connection.dlqName });

      setAutoSetupStage("Restaurando e preparando o D1…");
      const restoreResponse = await fetch("/api/setup/cloudflare/restore", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({ apiToken:cloudflareToken.trim(), accountId:connection.accountId, databaseId:connection.d1DatabaseId }),
      });
      const restore = await restoreResponse.json();
      if (!restoreResponse.ok) throw new Error(restore.error || `RESTORE_HTTP_${restoreResponse.status}`);

      setAutoSetupStage("Verificando D1, R2, Queue e Worker…");
      let latest: Health | null = null;
      for (let attempt=0; attempt<20; attempt+=1) {
        await new Promise(resolve=>setTimeout(resolve, attempt===0 ? 300 : 1000));
        const response = await fetch("/api/health", {cache:"no-store"});
        const raw = await response.json();
        latest = raw?.app === "ok" ? raw as Health : {app:"ok",architecture:"CLOUDFLARE_CORE",coreConfigured:true,core:{...raw,ok:Boolean(raw?.ok)}};
        setHealth(latest);
        if (latest.core.ok) break;
      }
      if (!latest?.core.ok) throw new Error(latest?.core.error || "CORE_HEALTH_NOT_READY");

      setAutoSetupStage("Gravando a configuração permanente…");
      const currentConfigResponse = await fetch("/api/infrastructure/config", {cache:"no-store"});
      const currentConfig = currentConfigResponse.ok ? await currentConfigResponse.json() : null;
      if (!currentConfig?.profile) {
        const lockResponse = await fetch("/api/infrastructure/config", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ bffProjectName:"corvo-library-v2", workerName:connection.workerName, d1DatabaseName:connection.d1DatabaseName, r2BucketName:connection.r2BucketName, queueName:connection.queueName, dlqName:connection.dlqName }) });
        const locked = await lockResponse.json();
        if (!lockResponse.ok) throw new Error(locked.error || `LOCK_HTTP_${lockResponse.status}`);
      } else if (infraProfile && infraEditing) {
        const changeResponse = await fetch("/api/infrastructure/config", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ bffProjectName:infraProfile.bffProjectName || "corvo-library-v2", workerName:connection.workerName, d1DatabaseName:connection.d1DatabaseName, r2BucketName:connection.r2BucketName, queueName:connection.queueName, dlqName:connection.dlqName, expectedRevision:infraProfile.revision, confirmChange:true }) });
        const changed = await changeResponse.json();
        if (!changeResponse.ok) throw new Error(changed.error || `CHANGE_HTTP_${changeResponse.status}`);
        setInfraEditing(false);
      }
      setCloudflareToken("");
      setCloudflareAccounts([]);
      setAutoSetupStage("Pronto. A configuração ficou gravada e travada.");
      setInfraMessage("Configuração concluída dentro do próprio app. Nenhuma variável manual na hospedagem e nada instalado no computador.");
      await Promise.all([refreshHealth(),refreshSettings(),refreshStats(),fetchCatalog(null,false)]);
    } catch(error) {
      setInfraMessage(error instanceof Error ? error.message : "AUTO_SETUP_FAILED");
      setAutoSetupStage("A configuração parou neste ponto; nada existente foi apagado.");
    } finally { setAutoSetupBusy(false); }
  }

  function forgetBrowserConnection() {
    clearBrowserConnection();
    setLocalConnection(null);
    setHealth(null);
    setInfraProfile(null);
    setInfraMessage("Conexão local removida deste navegador. Os recursos Cloudflare não foram apagados.");
  }

  function openMcpConnection() {
    setMcpCopied("");
    setMcpMessage("");
    setMcpShowKey(false);
    setMcpOpen(true);
  }

  async function copyMcpValue(kind:"url"|"key"|"bundle") {
    if (!localConnection) return;
    const endpoint=`${localConnection.coreUrl.replace(/\/$/,"")}/mcp`;
    const value=kind==="url"?endpoint:kind==="key"?localConnection.appKey:`MCP URL: ${endpoint}\nAuthorization: Bearer ${localConnection.appKey}`;
    await navigator.clipboard.writeText(value);
    setMcpCopied(kind);
    window.setTimeout(()=>setMcpCopied(""),1800);
  }

  async function rotateMcpKey() {
    if (!localConnection || mcpRotateBusy) return;
    setMcpRotateBusy(true); setMcpMessage("");
    try {
      const response=await fetch("/api/control/rotate-app-key",{method:"POST"});
      const value=await response.json();
      if(!response.ok || !value?.appKey) throw new Error(value?.error||`ROTATE_HTTP_${response.status}`);
      const next={...localConnection,appKey:String(value.appKey),savedAt:Date.now()};
      saveBrowserConnection(next);
      setLocalConnection(next);
      setMcpShowKey(true);
      setMcpMessage("Chave anterior revogada. A nova chave já foi salva neste navegador e está pronta para copiar.");
    } catch(error) {
      setMcpMessage(error instanceof Error?error.message:"MCP_KEY_ROTATION_FAILED");
    } finally { setMcpRotateBusy(false); }
  }

  async function updateCoreFromApp() {
    setCoreUpdateBusy(true); setInfraMessage("");
    try {
      const response = await fetch("/api/control/update-core", { method:"POST" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || `CORE_UPDATE_HTTP_${response.status}`);
      setInfraMessage(`Atualização do Core enviada para ${value.targetVersion || EXPECTED_CORE_VERSION}. Verificando…`);
      for (let attempt=0; attempt<24; attempt+=1) {
        await new Promise(resolve=>setTimeout(resolve, attempt===0 ? 800 : 1400));
        await refreshHealth();
        const probe = await fetch("/api/health", { cache:"no-store" });
        if (probe.ok) {
          const raw = await probe.json();
          const version = raw?.app === "ok" ? raw?.core?.version : raw?.version;
          if (version === EXPECTED_CORE_VERSION) {
            const migrationResponse=await fetch("/api/control/apply-migrations",{method:"POST"});
            const migration=await migrationResponse.json();
            if(!migrationResponse.ok)throw new Error(migration.error||`MIGRATION_HTTP_${migrationResponse.status}`);
            setInfraMessage(`Core atualizado para ${EXPECTED_CORE_VERSION}; migrations aplicadas: ${(migration.executed||[]).length}. A infraestrutura permaneceu travada.`);
            break;
          }
        }
      }
    } catch(error) {
      setInfraMessage(error instanceof Error ? error.message : "CORE_UPDATE_FAILED");
    } finally { setCoreUpdateBusy(false); }
  }

  async function verifyAndLockInfrastructure() {
    setSetupBusy(true); setInfraMessage("");
    try {
      const healthResponse = await fetch("/api/health", { cache:"no-store" });
      const current = await healthResponse.json() as Health;
      setHealth(current);
      if (!current.core.ok) {
        setInfraMessage(current.core.error || "O Core ainda não está totalmente conectado. Conclua a configuração automática dentro do app e tente novamente.");
        return;
      }
      if (!infraProfile) {
        const saveResponse = await fetch("/api/infrastructure/config", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(infraDraft) });
        const saved = await saveResponse.json();
        if (!saveResponse.ok) { setInfraMessage(saved.error || `HTTP_${saveResponse.status}`); return; }
        setInfraMessage(`Tudo certo. Configuração cravada na revisão ${saved.profile?.revision || 1}.`);
      } else {
        const verifyResponse = await fetch("/api/infrastructure/verify", { method:"POST" });
        const verified = await verifyResponse.json();
        setInfraMessage(verifyResponse.ok && verified.healthy ? "Infraestrutura verificada e saudável. Nenhuma configuração foi alterada." : (verified.error || "Configuração preservada, mas algum binding não respondeu."));
      }
      await Promise.all([refreshSettings(), refreshHealth()]);
    } finally { setSetupBusy(false); }
  }

  async function copyInfrastructureChecklist() {
    const checklist = `CORVO LIBRARY V2 — MODO AUTOSSUFICIENTE

Tudo é configurado pela própria tela Configurações.
1. Cole um Cloudflare API Token com acesso a Workers, D1, R2 e Queues.
2. A Library reutiliza o bucket corvoquiz-prod e cria/verifica D1, Queue, DLQ e Worker.
3. O app restaura o D1, publica o Core e grava a conexão neste navegador.
4. O token de controle fica como secret do Worker; não vai para D1, hospedagem nem localStorage.
5. Atualizações normais preservam a configuração. Só Alterar configuração muda a infraestrutura.`;
    try {
      await navigator.clipboard.writeText(checklist);
      setSetupCopied(true);
      setTimeout(() => setSetupCopied(false), 1800);
    } catch { setSetupCopied(false); }
  }


  const greeting = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";

  return <main className="shell shellV18">
    <aside className="sidebar sidebarV18">
      <div className="brand brandV18"><Mark /><div><strong>CORVO</strong><span>LIBRARY</span></div><button className="collapseHint" aria-label="Recolher menu">‹</button></div>
      <nav className="primaryNav">{primaryNav.map(item => <button key={item.id} className={active===item.id ? "active" : ""} onClick={() => setActive(item.id)}><span className="glyph"><UiIcon name={item.icon} size={19}/></span><span>{item.label}</span>{item.id === "Assets" && stats.pending > 0 && <em>{stats.pending}</em>}</button>)}</nav>
      <div className="sidebarFooter">
        <div className="profileMini"><span className="profileAvatar"><Mark /></span><div><strong>Corvo</strong><small>Administrador</small></div><b>⌄</b></div>
      </div>
    </aside>

    <section className="workspace">
      <header className="topbar topbarV18">
        <div />
        <div className="topActions"><button className="roundAction" aria-label="Notificações"><UiIcon name="bell" size={16}/></button><span className={`systemPill ${health?.core.ok ? "live" : "warn"}`}><i />Sistema operacional <b>{health?.core.ok ? "Saudável" : coreState}</b></span></div>
      </header>

      <div className="content contentV18">
        {active === "Visão geral" ? <div className="overviewTitle"><span>{greeting}, Corvo.</span><h1>Visão geral da <em>Corvo Library</em></h1><p>Acompanhe projetos, agentes e execuções em tempo real.</p></div> : <div className="titleRow titleRowV18"><div><span className="pageEyebrow">CORVO / {active.toUpperCase()}</span><h1>{active}</h1><p>{pageDescription}</p></div>{currentView === "Configurações" && <div className="titleActions"><button className="setupButton mcpConnectButton" onClick={openMcpConnection}>↗ Conectar MCP</button><button className="setupButton" onClick={() => openInfrastructureSetup(Boolean(infraProfile))}>⚙ {infraProfile ? "Alterar configuração" : "Configurar infraestrutura"}</button></div>}</div>}

        {active === "Visão geral" && <div className="overviewDashboard">
          <section className="overviewKpis">
            <article className="kpiCard violet"><span className="kpiIcon"><UiIcon name="layers" size={25}/></span><div><strong>{activeWorkerCount}</strong><span>Agentes ativos</span><small><i className="miniDot green"/> {health?.core.ok ? `${activeWorkerCount} online` : "Core indisponível"}</small></div></article>
            <article className="kpiCard blue"><span className="kpiIcon"><UiIcon name="folder" size={25}/></span><div><strong>{activeProjects.length}</strong><span>Projetos em execução</span><small><i className="miniDot blue"/> {projects.length} registrados na V2</small></div></article>
            <article className="kpiCard green"><span className="kpiIcon"><UiIcon name="pulse" size={25}/></span><div><strong>{recentOperations.length}</strong><span>Execuções recentes</span><small><i className="miniArrow">↑</i> Queue: {health?.core.queueBacklog ?? 0}</small></div></article>
            <article className="kpiCard violet"><span className="kpiIcon"><UiIcon name="target" size={25}/></span><div><strong>{operationSuccessRate}%</strong><span>Taxa de sucesso</span><small><i className="miniDot violet"/> {completedOps} concluídas</small></div></article>
          </section>

          <article className="dashboardPanel agentsHeroPanel">
            <header><div><h2>Agentes em tempo real</h2><p>Atuando entre projetos</p></div><button className="panelButton" onClick={()=>{setActive("Execuções");setExecutionView("Operação");}}>Ver todos os agentes</button></header>
            <AgentProjectNetwork projects={activeProjects} pending={stats.pending} queueBacklog={health?.core.queueBacklog ?? 0} online={Boolean(health?.core.ok)}/>
            <div className="systemMicrobar"><span><i className={health?.core.d1==="ok"?"live":""}/>D1 {health?.core.d1?.toUpperCase() || "—"}</span><span><i className={health?.core.r2==="ok"?"live":""}/>R2 {health?.core.r2?.toUpperCase() || "—"}</span><span><i className={health?.core.ok?"live":""}/>Heartbeats {activeWorkerCount}</span><span><i className={stats.pending===0?"live":"warn"}/>Pendentes {stats.pending}</span></div>
          </article>

          <article className="dashboardPanel projectsHeroPanel">
            <header><div><h2>Projetos em execução</h2></div><button className="panelButton" onClick={()=>{setActive("Projetos");setProjectView("Projetos");}}>Ver todos os projetos</button></header>
            <div className="projectStrip">{Array.from({length:5},(_,index)=>activeProjects[index] || null).map((project,index)=>{const progress=project?progressForProject(project):0;return <div className={`projectTile ${project?"live":"idle"}`} key={project?.id || `project-slot-${index}`}><span className={`projectCover cover${index+1}`}>{project?.name?.slice(0,1).toUpperCase() || "+"}</span><div className="projectTileBody"><strong>{project?.name || "Slot livre"}</strong><small>{project?String(project.pipeline_status||project.status||"EM EXECUÇÃO"):"Aguardando projeto"}</small><span className="projectState"><i className={project?"live":""}/>{project?"Em execução":"Disponível"}</span><div className="projectTileProgress"><i style={{width:`${progress}%`}}/></div></div><b>{project?`${progress}%`:"—"}</b></div>})}</div>
          </article>

          <article className="activityBar">
            <div className="activityBarTitle"><strong>Atividade recente</strong></div>
            <div className="activityBarItems">{recentOperations.length===0?<div className="activityCompact emptyActivity"><span className="activityIcon violet"><UiIcon name="activity" size={15}/></span><div><strong>Sistema aguardando atividade</strong><small>FAST PUSH, análises e exports aparecerão aqui.</small></div></div>:recentOperations.slice(0,4).map((item,index)=>{const state=String(item.status||"PROCESSING"); const icons:[UiIconName,string][]=[["layers","violet"],["target","blue"],["spark","green"],["download","orange"]];const [icon,tone]=icons[index%icons.length];return <div className="activityCompact" key={String(item.id||index)}><span className={`activityIcon ${tone}`}><UiIcon name={icon} size={15}/></span><div><strong>{String(item.type||item.operation_type||"Operação")}</strong><small>{state} · {String(item.id||"").slice(0,12)}</small></div></div>})}</div>
            <button className="panelButton" onClick={()=>{setActive("Execuções");setExecutionView("Operação");}}>Ver todas</button>
          </article>
        </div>}

        {active === "Assets" && <>
          <div className="moduleTabs assetTabs">{["Catálogo","Pendentes","Rejeitados","Importar & R2"].map(item=><button key={item} className={assetView===item?"active":""} onClick={()=>{setAssetView(item);clearAssetSelection();}}><span>{item}</span>{item!=="Importar & R2"&&<b>{item==="Catálogo"?stats.approved:item==="Pendentes"?stats.pending:stats.rejected}</b>}</button>)}</div>
          <section className="metricStrip">
            <div><strong>{stats.total.toLocaleString("pt-BR")}</strong><span>Total</span></div>
            <div><strong>{stats.approved.toLocaleString("pt-BR")}</strong><span>Aprovados</span></div>
            <div><strong>{stats.pending.toLocaleString("pt-BR")}</strong><span>Pendentes</span></div>
            <div><strong>{stats.universes.toLocaleString("pt-BR")}</strong><span>Universos</span></div>
            <div><strong>{stats.uses.toLocaleString("pt-BR")}</strong><span>Usos</span></div>
            <div><strong>{formatBytes(stats.bytes)}</strong><span>Mídia catalogada</span></div>
          </section>

          {assetView === "Importar & R2" && <section className="importHub">
            <div className="importHero">
              <div><span className="eyebrow">ENTRADA CONTROLADA</span><h2>Importar mídia e sincronizar com R2</h2><p>Envie vários lotes ZIP de até 48 MB. Cada lote vai direto ao R2, é catalogado no D1 por SHA-256 e o arquivo ZIP de transporte é removido depois da materialização.</p></div>
              <div className="syncStatusPill"><i className={r2CatalogSync?.ok?"live":""}/><span>{r2CatalogSync?.ok?"R2 / D1 sincronizados":r2CatalogSync?"Revisão necessária":"Ainda não verificado"}</span></div>
            </div>
            <div className="importGrid">
              <div className="importDropCard">
                <label className="zipDrop"><input type="file" multiple accept=".zip,application/zip" onChange={(event:ChangeEvent<HTMLInputElement>)=>setImportFiles(Array.from(event.target.files||[]))}/><span className="zipIcon">ZIP</span><strong>Selecionar lotes de importação</strong><small>Use os lotes CORVO_IMPORT_LOTE_*.zip · máximo 48 MB por arquivo</small></label>
                {importFiles.length>0&&<div className="selectedImportFiles">{importFiles.map(file=><div key={`${file.name}-${file.size}`}><span><b>{file.name}</b><small>{formatBytes(file.size)}</small></span><em className={file.size>MAX_IMPORT_ZIP_BYTES?"bad":"ok"}>{file.size>MAX_IMPORT_ZIP_BYTES?"ACIMA DO LIMITE":"PRONTO"}</em></div>)}</div>}
                <div className="importActions"><button className="primary" disabled={importBusy||!importFiles.length} onClick={()=>void importSelectedBatches()}>{importBusy?"Importando lotes…":`Importar ${importFiles.length||""} lote(s)`}</button><button disabled={importBusy||!importFiles.length} onClick={()=>{setImportFiles([]);setImportProgress([]);setImportMessage("");}}>Limpar</button></div>
                {importMessage&&<div className={importMessage.includes("falha")||importMessage.includes("ERRO")||importMessage.includes("acima")?"formError":"setupMessage"}>{importMessage}</div>}
              </div>
              <div className="r2SyncCard">
                <span className="eyebrow">RECONCILIAÇÃO CRUZADA</span><h3>R2 físico × catálogo D1</h3><p>Cruza todos os objetos em <code>assets/</code> com o catálogo D1. Se o D1 perder um registro, a Library reconstrói a referência usando os metadados persistidos junto da mídia; se um arquivo físico faltar, ela sinaliza sem inventar conteúdo.</p>
                <div className="syncNumbers"><span><b>{r2CatalogSync?.scannedR2??"—"}</b>R2</span><span><b>{r2CatalogSync?.d1Assets??stats.total}</b>D1</span><span><b>{r2CatalogSync?.uncatalogedAfter??"—"}</b>sem catálogo</span><span><b>{r2CatalogSync?.missingInR2??"—"}</b>sem arquivo</span></div>
                <button className="primary" disabled={r2SyncBusy||importBusy} onClick={()=>void runR2CatalogSync(true)}>{r2SyncBusy?"Sincronizando…":"Verificar e sincronizar agora"}</button>
                {r2SyncMessage&&<div className={r2CatalogSync&&!r2CatalogSync.ok?"formError":"setupMessage"}>{r2SyncMessage}</div>}
              </div>
            </div>
            {importProgress.length>0&&<div className="importProgressList"><header><strong>Progresso da carga</strong><span>{importProgress.filter(item=>item.state==="CONCLUÍDO").length}/{importProgress.length} concluídos</span></header>{importProgress.map(item=><div key={item.name}><span><b>{item.name}</b><small>{item.detail}</small></span><em className={item.state==="ERRO"?"error":item.state==="CONCLUÍDO"?"done":"working"}>{item.state}</em></div>)}</div>}
            <div className="recentImports"><span className="eyebrow">HISTÓRICO RECENTE</span>{recordLoading?<div className="quiet">Carregando…</div>:imports.length===0?<div className="quiet">Nenhuma importação ainda.</div>:imports.slice(0,10).map(item=><article key={item.id}><div><strong>{item.file_name}</strong><span>{formatBytes(item.size_bytes)} · {item.status}</span></div><code>{item.id}</code></article>)}</div>
          </section>}

          {assetView !== "Importar & R2" && <><section className="catalogTools">
            <label className="searchBox"><span>⌕</span><input value={query} onChange={(e: ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)} placeholder="Buscar nome, universo, personagem ou tag..." /></label>
            <select value={universe} onChange={(e: ChangeEvent<HTMLSelectElement>)=>setUniverse(e.target.value)}><option value="">Todos os universos</option>{universes.map(item => <option key={item.name} value={item.name}>{item.name} ({item.total})</option>)}</select>
            <div className={`assetViewBadge ${assetView.toLowerCase()}`}><span>VISÃO</span><strong>{assetView}</strong></div>
          </section>
          {assetView === "Pendentes" && <section className="pendingReconcilePanel">
            <div className="pendingReconcileHead"><div><span className="eyebrow">RECONCILIAÇÃO R2</span><h2>Achar arquivos dos Pendentes</h2><p>Procura em todo o bucket <code>corvoquiz-prod</code> o arquivo físico de cada registro pendente. A varredura não aprova nem rejeita nada.</p></div><button className="primary" disabled={pendingR2Busy} onClick={()=>void scanPendingR2()}>{pendingR2Busy?"Procurando…":pendingR2?"Vasculhar novamente":"Vasculhar pendentes no R2"}</button></div>
            {pendingR2 && <><div className="opNumbers pendingR2Numbers"><span><b>{pendingR2.pending}</b>pendentes</span><span><b>{pendingR2.present}</b>arquivo já OK</span><span><b>{pendingR2.repairable}</b>achados em outro local</span><span><b>{pendingR2.probable}</b>possíveis</span><span><b>{pendingR2.unresolved}</b>não encontrados</span></div>
              {pendingR2.inventoryTruncated&&<div className="formError">A varredura atingiu o limite de objetos; o resultado pode ser parcial.</div>}
              {(pendingR2.repairable>0||pendingR2.unresolved>0)&&<div className="pendingRepairBar"><span>{pendingR2.repairable>0?<>Foram encontrados <b>{pendingR2.repairable}</b> arquivo(s) com correspondência forte. Eles podem ser religados sem mudar o status.</>:<>Há <b>{pendingR2.unresolved}</b> registro(s) sem arquivo no bucket. A política V2 é excluir o estado morto e recaptar novo.</>}</span><div className="pendingRepairActions">{pendingR2.repairable>0&&<button disabled={pendingR2RepairBusy||bulkBusy} onClick={()=>void repairPendingR2()}>{pendingR2RepairBusy?"Religando…":`Religar ${pendingR2.repairable}`}</button>}{pendingR2.unresolved>0&&<button className="danger" disabled={bulkBusy} onClick={()=>void deleteUnresolvedPending()}>{bulkBusy?"Excluindo…":`Excluir ${pendingR2.unresolved} não encontrado(s)`}</button>}</div></div>}
              <div className="pendingMatchList">{pendingR2.items.filter(item=>item.state!=="FOUND_CURRENT").slice(0,80).map(item=><article key={item.assetId} className={`pendingMatch ${item.state.toLowerCase()}`}><div><strong>{item.name}</strong><span>{item.universe} · {item.assetId}</span><code>{item.currentR2Key}</code></div><div className="pendingMatchResult"><b>{item.state==="FOUND_ALTERNATE"?"ENCONTRADO":item.state==="POSSIBLE_MATCH"?"POSSÍVEL":"NÃO LOCALIZADO"}</b>{item.bestMatch&&<><code>{item.bestMatch.key}</code><small>{item.bestMatch.reasons.join(" · ")}</small></>}</div></article>)}</div>
            </>}
            {pendingR2Message&&<div className="setupMessage">{pendingR2Message}</div>}
          </section>}
          {assets.length>0&&<section className="bulkAssetBar"><div className="bulkSelect"><button onClick={selectLoadedAssets} disabled={bulkBusy}>Selecionar carregados</button>{selectedAssetIds.length>0&&<button onClick={clearAssetSelection} disabled={bulkBusy}>Limpar seleção</button>}<strong>{selectedAssetIds.length} selecionado(s)</strong></div><div className="bulkActions"><button disabled={bulkBusy||selectedAssetIds.length===0} onClick={()=>void downloadSelectedZip()}>Baixar ZIP</button>{(assetView==="Pendentes"||selectedPendingCount>0)&&<button className="approve" disabled={bulkBusy||selectedPendingCount===0} onClick={()=>void bulkApproveAssets()}>Aprovar ({selectedPendingCount})</button>}<button className="danger" disabled={bulkBusy||selectedAssetIds.length===0} onClick={()=>void bulkDeleteAssets()}>Excluir permanentemente</button></div></section>}
          {bulkMessage&&<div className={bulkMessage.includes("FAILED")||bulkMessage.includes("HTTP_")||bulkMessage.includes("ERROR")?"formError":"setupMessage"}>{bulkMessage}</div>}
                    {selectedUniverse && <div className="filterContext"><b>{selectedUniverse.name}</b><span>{selectedUniverse.approved} aprovados · {selectedUniverse.pending} pendentes · {selectedUniverse.rejected} rejeitados</span></div>}

          {!health?.coreConfigured && <div className="notice"><strong>Fundação criada.</strong><span>Falta apenas conectar o projeto ao Corvo Core. A V2 não solicitará credenciais Cloudflare na interface.</span></div>}

          {loading ? <div className="empty">Carregando catálogo…</div> : assets.length === 0 ? <div className="empty"><Mark /><strong>Nenhum asset para estes filtros</strong><span>O catálogo será lido diretamente do D1 restaurado, sem seed de produção ou snapshot intermediário.</span></div> : <>
            <div className="resultMeta"><span>{total.toLocaleString("pt-BR")} resultados</span><span>{assets.length.toLocaleString("pt-BR")} carregados</span></div>
            <div className="grid">{assets.map(asset => <article className={`card ${selectedAssets.has(asset.id)?"selected":""}`} key={asset.id}>
              <div className="preview"><label className="assetCheck"><input type="checkbox" checked={selectedAssets.has(asset.id)} onChange={()=>toggleAssetSelection(asset.id)} aria-label={`Selecionar ${asset.name}`}/><span>✓</span></label><span className="previewFallback">◇</span>{asset.previewUrl && <img src={asset.previewUrl} alt={asset.name} loading="lazy" onError={(event:{currentTarget:HTMLImageElement})=>{event.currentTarget.style.display="none";}}/>}<em className={statusClass(asset.status)}>{asset.rawStatus || asset.status}</em></div>
              <div className="cardBody"><strong>{asset.name}</strong><span className="universeLine">{asset.universe || "Sem universo"}{asset.subject ? ` · ${asset.subject}` : ""}</span><div className="assetMetaLine"><i>{asset.kind}</i><i>{formatBytes(Number(asset.sizeBytes||0))}</i>{asset.qaStatus&&<i>{asset.qaStatus.replace(/_/g," ")}</i>}</div><div>{asset.tags.slice(0,3).map(tag => <small key={tag}>{tag}</small>)}</div><footer><code>{asset.id}</code><b>{asset.uses} usos</b></footer></div>
            </article>)}</div>
            {nextCursor && <div className="loadMore"><button disabled={loadingMore} onClick={() => void fetchCatalog(nextCursor, true)}>{loadingMore ? "Carregando…" : "Carregar mais"}</button></div>}
          </>}
          </>}
        </>}

        {active === "Projetos" && <div className="moduleTabs">{["Projetos","Solicitações","Lotes","Importações"].map(item=><button key={item} className={projectView===item?"active":""} onClick={()=>setProjectView(item)}><span>{item}</span></button>)}</div>}
        {active === "Execuções" && <div className="moduleTabs">{["Coleta automática","Inbox candidatas","Operação"].map(item=><button key={item} className={executionView===item?"active":""} onClick={()=>setExecutionView(item)}><span>{item}</span></button>)}</div>}
        {active === "Análise" && <div className="moduleTabs">{["Estoque & giro","Políticas"].map(item=><button key={item} className={analysisView===item?"active":""} onClick={()=>setAnalysisView(item)}><span>{item}</span></button>)}</div>}

        {currentView === "Projetos" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">PROJETOS V2</span><h2>Projetos novos e funcionais</h2><p>O histórico visual antigo foi removido. Daqui em diante só ficam projetos criados e operados pela V2.</p><form className="pushForm" onSubmit={createProject}><input value={projectName} onChange={(e: ChangeEvent<HTMLInputElement>)=>setProjectName(e.target.value)} placeholder="Nome do projeto"/><button className="primary">Criar projeto</button></form></div>
          <div className="recordList">{recordLoading?<div className="quiet">Carregando…</div>:projects.length===0?<div className="quiet">Nenhum projeto.</div>:projects.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.pipeline_status || item.status} · {item.approved_count||0}/{item.total_items||0} aprovados</span></div><div className="inlineActions"><code>{item.id}</code><button onClick={()=>void projectAction(item.id,"reconcile")}>Reconciliar</button><button onClick={()=>void projectAction(item.id,"process")}>Processar</button></div></article>)}</div>
        </section>}

        {currentView === "Solicitações" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">SOLICITAÇÕES</span><h2>Fila de solicitações</h2><p>Cria e lê diretamente a tabela histórica <code>requests</code>.</p>
            <form className="pushForm" onSubmit={createLibraryRequest}><input value={requestProject} onChange={(e: ChangeEvent<HTMLInputElement>)=>setRequestProject(e.target.value)} placeholder="Projeto"/><textarea rows={8} value={requestItems} onChange={(e: ChangeEvent<HTMLTextAreaElement>)=>setRequestItems(e.target.value)} placeholder="Um item por linha"/><button className="primary">Criar solicitação</button></form>
          </div>
          <div className="recordList">{recordLoading ? <div className="quiet">Carregando…</div> : requests.length===0 ? <div className="quiet">Nenhuma solicitação.</div> : requests.map(item=><article key={item.id}><div><strong>{item.project}</strong><span>{item.item_count} itens · {item.status}</span></div><code>{item.id}</code></article>)}</div>
        </section>}

        {currentView === "Lotes" && <section className="modulePanel twoCol">
          <div><span className="eyebrow">LOTES</span><h2>Lotes sobre o D1 histórico</h2><p>Manifestos novos são gravados diretamente no R2 via binding.</p>
            <form className="pushForm" onSubmit={createLibraryBatch}><input value={batchName} onChange={(e: ChangeEvent<HTMLInputElement>)=>setBatchName(e.target.value)} placeholder="Nome do lote"/><input value={batchProject} onChange={(e: ChangeEvent<HTMLInputElement>)=>setBatchProject(e.target.value)} placeholder="Projeto opcional"/><button className="primary">Criar lote</button></form>
          </div>
          <div className="recordList">{recordLoading ? <div className="quiet">Carregando…</div> : batches.length===0 ? <div className="quiet">Nenhum lote.</div> : batches.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.project || "Sem projeto"} · {item.status}</span></div><div className="inlineActions"><code>{item.id}</code><button onClick={()=>void generateManifest(item.id)}>Manifesto</button></div></article>)}</div>
        </section>}

        {currentView === "Importações" && <section className="modulePanel"><span className="eyebrow">HISTÓRICO</span><h2>Histórico de importações</h2><p>Nesta fase a V2 lê a tabela histórica sem reinterpretar os registros.</p><div className="recordList wide">{recordLoading ? <div className="quiet">Carregando…</div> : imports.length===0 ? <div className="quiet">Nenhuma importação.</div> : imports.map(item=><article key={item.id}><div><strong>{item.file_name}</strong><span>{formatBytes(item.size_bytes)} · {item.status}</span></div><code>{item.id}</code></article>)}</div></section>}

        {currentView === "Coleta automática" && <section className="modulePanel twoCol">
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

        {currentView === "Inbox candidatas" && <>
          <section className="candidateToolbar"><div><b>Inbox de materialização</b><span>Aprovar move o objeto de incoming/ para assets/ e cria o AST-* no D1 histórico.</span></div><select value={candidateState} onChange={(e: ChangeEvent<HTMLSelectElement>)=>setCandidateState(e.target.value)}><option value="MATERIALIZED">Materializadas</option><option value="RETRYING">Em retry</option><option value="FAILED">Falhas</option><option value="APPROVED">Aprovadas</option><option value="REJECTED">Rejeitadas</option></select></section>
          {candidateLoading ? <div className="empty">Carregando candidatas…</div> : candidates.length === 0 ? <div className="empty"><strong>Inbox vazia</strong><span>As mídias do FAST PUSH aparecem aqui depois que a Queue conclui a materialização.</span></div> : <div className="candidateGrid">{candidates.map(candidate => <article className="candidate" key={candidate.id}>
            <div className="candidatePreview"><span className="previewFallback">◇</span>{candidate.previewUrl && <img src={candidate.previewUrl} alt="" onError={(event:{currentTarget:HTMLImageElement})=>{event.currentTarget.style.display="none";}}/>}</div>
            <div className="candidateBody"><div className="candidateTitle"><strong>{candidate.subject || "Sem assunto"}</strong><b className={statusClass(candidate.status)}>{candidate.status}</b></div><span>{candidate.universe || "Sem universo"}</span><code>{candidate.id}</code><small>{formatBytes(candidate.sizeBytes)} · tentativa {candidate.attempts}</small>{candidate.failureReason && <p>{candidate.failureReason}</p>}
              {candidate.status === "MATERIALIZED" && <div className="decisionRow"><button className="approve" onClick={() => void decideCandidate(candidate.id,"approve")}>Aprovar</button><button className="reject" onClick={() => void decideCandidate(candidate.id,"reject")}>Rejeitar</button></div>}
            </div>
          </article>)}</div>}
        </>}

        {currentView === "Operação" && <section className="modulePanel operationGrid">
          <div><span className="eyebrow">INTEGRIDADE RÁPIDA</span><h2>D1 ↔ R2</h2><p>A amostra valida os <code>r2_key</code> mais recentes sem alterar qualquer registro.</p><div className="opNumbers"><span><b>{integrity?.checked ?? 0}</b>checados</span><span><b>{integrity?.present ?? 0}</b>presentes</span><span><b>{integrity?.missing ?? 0}</b>faltantes</span></div>{integrity?.missing ? <div className="formError">{integrity.missing} referências sem objeto na amostra.</div> : <div className="notice compact"><strong>Amostra limpa</strong><span>Nenhum objeto faltante na checagem rápida.</span></div>}</div>
          <div><span className="eyebrow">AUDITORIA COMPLETA</span><h2>Todas as referências conhecidas</h2><p>Compara assets, arquivos de projeto, imports, exports e materializações com o inventário físico do R2.</p><div className="opNumbers"><span><b>{storageAudit?.r2Objects ?? 0}</b>objetos R2</span><span><b>{storageAudit?.missingReferences ?? 0}</b>faltantes</span><span><b>{storageAudit?.orphanObjects ?? 0}</b>órfãos</span><span><b>{storageAudit?.sharedKeys ?? 0}</b>chaves compartilhadas</span></div><button className="primary" disabled={auditBusy} onClick={()=>void runStorageAudit()}>{auditBusy?"Auditando…":"Executar auditoria completa"}</button></div>
          <div><span className="eyebrow">INTEGRIDADE LÓGICA D1</span><h2>Integridade da V2</h2><p>A Library inicia sem histórico recuperado. Qualquer inconsistência nova em <code>v2_*</code> aparece aqui para diagnóstico.</p><div className="opNumbers"><span><b>{dataHealth?.v2Orphans ?? 0}</b>órfãos V2</span><span><b>{dataHealth?.activeHistoricalOrphans ?? 0}</b>históricos ativos</span><span><b>{dataHealth?.catalog.assetsMissingR2Key ?? 0}</b>assets sem r2_key</span><span><b>{dataHealth?.catalog.duplicateAssetR2Keys ?? 0}</b>r2_key compartilhadas</span></div><div className={(dataHealth?.v2Orphans||0)>0?"formError":"notice compact"}><strong>{(dataHealth?.v2Orphans||0)>0?"Regressão V2 detectada":"Camada V2 consistente"}</strong><span>{dataHealth?.activeHistoricalOrphans ? "Há registros inconsistentes que precisam de revisão." : "Nenhuma inconsistência ativa detectada."}</span></div></div>
          <div><span className="eyebrow">DISPATCHER</span><h2>Workers e leases</h2><div className="opNumbers"><span><b>{dispatcherHealth?.expiredLeases ?? 0}</b>leases expirados</span><span><b>{dispatcherHealth?.queue?.length ?? 0}</b>grupos de fila</span><span><b>{dispatcherHealth?.sessions?.length ?? 0}</b>grupos de sessões</span></div><div className={dispatcherHealth?.ok===false?"formError":"notice compact"}><strong>{dispatcherHealth?.ok===false?"Atenção":"Dispatcher saudável"}</strong><span>Leases expirados voltam para READY pelo watchdog, sem perder o item.</span></div></div>
          <div><span className="eyebrow">MATERIALIZAÇÃO</span><h2>FAST PUSH</h2><div className="recordList">{(materializationStats?.candidateStates||[]).length===0?<div className="quiet">Sem estatísticas.</div>:(materializationStats?.candidateStates||[]).map((item,index)=><article key={`${String(item.status)}-${index}`}><div><strong>{String(item.status)}</strong><span>{Number(item.bytes||0)>0?formatBytes(Number(item.bytes)):""}</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">OPERAÇÕES RECENTES</span><h2>Fila assíncrona</h2><div className="recordList">{recentOperations.length===0?<div className="quiet">Nenhuma operação.</div>:recentOperations.map(item=><article key={String(item.id)}><div><strong>{String(item.type||"OP")}</strong><span>{String(item.status||"")} · {String(item.succeeded||0)}/{String(item.requested||0)}</span></div><code>{String(item.id)}</code></article>)}</div></div>
          <div><span className="eyebrow">R2 — assets/</span><h2>Inventário recente</h2><div className="recordList">{r2Objects.length===0?<div className="quiet">Nenhum objeto carregado ou Core ainda desconectado.</div>:r2Objects.map(item=><article key={item.key}><div><strong>{item.key.split("/").pop()}</strong><span>{formatBytes(item.size)}</span></div><code>{item.key}</code></article>)}</div></div>
          <div className="r2ExplorerPanel"><div className="r2ExplorerHead"><div><span className="eyebrow">EXPLORADOR FÍSICO R2</span><h2>Explorar armazenamento R2</h2><p>Ferramenta secundária de diagnóstico. Navega pelas pastas físicas e cruza chaves com o D1; não é a reconciliação de Pendentes.</p></div><button className="primary" disabled={r2ExploreBusy} onClick={()=>void exploreR2(r2Explorer?.prefix||"")}>{r2ExploreBusy?"Explorando…":r2Explorer?"Atualizar exploração":"Explorar R2"}</button></div>
            {r2ExploreError&&<div className="formError">{r2ExploreError}</div>}
            {r2Explorer&&<><div className="r2Breadcrumbs">{r2Explorer.breadcrumbs.map((crumb,index)=><button key={`${crumb.prefix}-${index}`} onClick={()=>void exploreR2(crumb.prefix)} disabled={r2ExploreBusy}>{crumb.name}</button>)}</div><div className="opNumbers r2Numbers"><span><b>{r2Explorer.scannedObjects.toLocaleString("pt-BR")}</b>objetos</span><span><b>{formatBytes(r2Explorer.totalBytes)}</b>armazenados</span><span><b>{r2Explorer.referencedObjects.toLocaleString("pt-BR")}</b>referenciados</span><span><b>{r2Explorer.orphanObjects.toLocaleString("pt-BR")}</b>sem referência</span></div>{r2Explorer.truncated&&<div className="formError">A varredura atingiu o limite de {r2Explorer.maxObjects.toLocaleString("pt-BR")} objetos. Os números são parciais.</div>}
              <div className="r2FolderGrid">{r2Explorer.folders.length===0&&r2Explorer.objects.length===0?<div className="quiet">Nenhum objeto neste caminho.</div>:r2Explorer.folders.map(folder=><button className="r2Folder" key={folder.prefix} onClick={()=>void exploreR2(folder.prefix)} disabled={r2ExploreBusy}><span className="r2FolderIcon">▰</span><strong>{folder.name}/</strong><small>{folder.objects.toLocaleString("pt-BR")} objetos · {formatBytes(folder.bytes)}</small><em className={folder.orphanObjects>0?"waitState":"okState"}>{folder.referencedObjects} ligados · {folder.orphanObjects} sem referência</em></button>)}</div>
              {r2Explorer.objects.length>0&&<div className="recordList wide r2ObjectList">{r2Explorer.objects.map(item=><article key={item.key}><div><strong>{item.key.split("/").pop()}</strong><span>{formatBytes(item.size)} · {new Date(item.uploaded).toLocaleString("pt-BR")}</span></div><div className="r2ObjectMeta"><b className={item.referenced?"okState":"waitState"}>{item.referenced?"REFERENCIADO":"SEM REFERÊNCIA"}</b><code>{item.key}</code></div></article>)}</div>}
            </>}
          </div>
        </section>}

        {currentView === "Políticas" && <section className="modulePanel operationGrid">
          <div><span className="eyebrow">APRENDIZADO OPERACIONAL</span><h2>Gaps</h2><p>Os gaps são deduplicados por assinatura e permanecem auditáveis.</p><div className="recordList">{(policyWorkspace?.gaps||[]).length===0?<div className="quiet">Nenhum gap registrado.</div>:(policyWorkspace?.gaps||[]).map((item,index)=><article key={`${String(item.status)}-${String(item.category)}-${index}`}><div><strong>{String(item.category||"GAP")}</strong><span>{String(item.severity||"")} · {String(item.status||"")}</span></div><code>{String(item.count||item.occurrence_count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">POLÍTICAS</span><h2>Versões e estado</h2><p>Alterações criam novas versões; rollback não apaga histórico.</p><div className="recordList">{(policyWorkspace?.policies||[]).length===0?<div className="quiet">Nenhuma política registrada.</div>:(policyWorkspace?.policies||[]).map((item,index)=><article key={`${String(item.status)}-${String(item.category)}-${index}`}><div><strong>{String(item.category||"POLICY")}</strong><span>{String(item.status||"")} · {String(item.applied||0)} aplicações</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
          <div><span className="eyebrow">TELEMETRIA</span><h2>Aplicações e resultados</h2><div className="recordList">{(policyTelemetry?.events||[]).length===0?<div className="quiet">Sem eventos de política.</div>:(policyTelemetry?.events||[]).map((item,index)=><article key={`${String(item.event_type)}-${index}`}><div><strong>{String(item.event_type||"EVENT")}</strong><span>{String(item.successes||"")}</span></div><code>{String(item.count||0)}</code></article>)}</div></div>
        </section>}

        {currentView === "Estoque & giro" && <section className="modulePanel operationGrid"><div><span className="eyebrow">ESTOQUE</span><h2>{stats.approved.toLocaleString("pt-BR")} aprovados em {stats.universes.toLocaleString("pt-BR")} universos ativos</h2><p>Derivado diretamente da tabela histórica <code>assets</code>, sem conversão.</p><div className="recordList wide">{universes.slice(0,40).map(item=><article key={item.name}><div><strong>{item.name}</strong><span>{item.approved} aprovados · {item.pending} pendentes · {item.rejected} rejeitados</span></div><code>{item.total} total</code></article>)}</div></div><div><span className="eyebrow">GIRO</span><h2>Uso do catálogo</h2><div className="recordList">{(stockDetail?.rotation||[]).map((item,index)=><article key={`${String(item.bucket)}-${index}`}><div><strong>{String(item.bucket)}</strong><span>assets aprovados</span></div><code>{String(item.count||0)}</code></article>)}</div></div><div><span className="eyebrow">POLÍTICAS DE ESTOQUE</span><h2>Limites semânticos</h2><div className="recordList">{(stockDetail?.policies||[]).length===0?<div className="quiet">Nenhuma política ativa.</div>:(stockDetail?.policies||[]).slice(0,50).map((item,index)=><article key={`${String(item.id)}-${index}`}><div><strong>{String(item.concept||"conceito")}</strong><span>{String(item.universe||"Sem universo")} · min {String(item.minimum||0)} / ideal {String(item.ideal||0)}</span></div><code>{String(item.maximum||0)} max</code></article>)}</div></div></section>}

        {currentView === "Configurações" && <section className="modulePanel configPanel">
          <span className="eyebrow">INFRAESTRUTURA AUTOSSUFICIENTE</span><h2>Configura uma vez e fica cravado</h2><p>A própria Corvo Library cria/verifica o Core na Cloudflare. Nada para instalar no computador e nenhuma variável manual na hospedagem do app. O D1 guarda somente o manifesto não secreto; chaves sensíveis ficam como secrets do Worker.</p>
          <div className="setupCallout"><div><strong>{infraProfile ? `Configuração travada · revisão ${infraProfile.revision}` : localConnection ? "Conexão local encontrada — verificando Core" : "Configuração ainda não concluída"}</strong><span>{infraProfile ? `Instância ${infraProfile.instanceId} · só muda pelo botão Alterar configuração.` : "Cole uma única credencial Cloudflare e a Library cuida de D1, R2, Queue, Worker e restauração."}</span></div><button className="primary" onClick={() => openInfrastructureSetup(false)}>{infraProfile ? "Ver configuração" : "Configurar agora"}</button></div>
          {infraProfile && <div className="lockedConfig"><div><span>ESTADO</span><strong>🔒 LOCKED</strong></div><div><span>INSTÂNCIA</span><code>{infraProfile.instanceId}</code></div><div><span>REVISÃO</span><strong>{infraProfile.revision}</strong></div><div><span>ÚLTIMA ALTERAÇÃO</span><strong>{new Date(infraProfile.updatedAt).toLocaleString("pt-BR")}</strong></div></div>}
          <div className="bindingList"><div><b>DB</b><span>D1 · {infraProfile?.d1DatabaseName || localConnection?.d1DatabaseName || "corvo-library-v2"}</span><em>{health?.core.d1 || "aguardando"}</em></div><div><b>MEDIA</b><span>R2 · {infraProfile?.r2BucketName || localConnection?.r2BucketName || "corvoquiz-prod"}</span><em>{health?.core.r2 || "aguardando"}</em></div><div><b>MATERIALIZE_QUEUE</b><span>Queue · {infraProfile?.queueName || localConnection?.queueName || "corvo-materialize-v2"}</span><em>{health?.core.queue || "aguardando"}</em></div><div><b>APP AUTH</b><span>Chave de sessão da Library · não é credencial Cloudflare</span><em>{health?.core.appAuth || (localConnection ? "salva" : "aguardando")}</em></div><div><b>CONTROLE</b><span>API Token Cloudflare · secret exclusivo do Worker</span><em>{health?.core.control || "aguardando"}</em></div></div>
          {localConnection && <div className="notice compact"><strong>Conexão deste navegador salva</strong><span>{localConnection.coreUrl} · atualizações do frontend não apagam esta conexão.</span></div>}
          {health?.core.ok && health.core.version && health.core.version !== EXPECTED_CORE_VERSION && <div className="setupCallout updateCallout"><div><strong>Atualização do Core disponível</strong><span>Worker {health.core.version} → {EXPECTED_CORE_VERSION}. A atualização usa o token já guardado no próprio Worker e não pede nova configuração.</span></div><button className="primary" disabled={coreUpdateBusy} onClick={()=>void updateCoreFromApp()}>{coreUpdateBusy ? "Atualizando…" : "Atualizar Core"}</button></div>}
          <div className="notice compact"><strong>Regra de persistência</strong><span>Atualizar/reabrir = preservar · alterar = somente por ação explícita · credenciais R2 no D1: {String(bindingStatus?.r2CredentialsStoredInD1??false)}</span></div>
          {infraEvents.length>0 && <div className="recordList wide">{infraEvents.slice(0,8).map((item,index)=><article key={`${String(item.id)}-${index}`}><div><strong>{String(item.event_type||"EVENT")}</strong><span>revisão {String(item.next_revision||"")} · {new Date(Number(item.created_at||0)).toLocaleString("pt-BR")}</span></div><code>{String(item.source||"")}</code></article>)}</div>}
          <div className="recordList wide">{safeSettings.slice(0,60).map(item=><article key={item.key}><div><strong>{item.key}</strong><span>setting operacional persistente</span></div><code>{item.value}</code></article>)}</div>
        </section>}

        {!["Visão geral","Assets","Projetos","Execuções","Análise","Configurações"].includes(active) && <div className="modulePlaceholder"><strong>{active}</strong><p>Este módulo será ligado ao núcleo V2 sem duplicar navegação ou estado visual.</p><span>EM DESENVOLVIMENTO CONTÍNUO</span></div>}

        {mcpOpen && <div className="setupOverlay" role="dialog" aria-modal="true" aria-label="Conectar MCP">
          <div className="setupModal mcpModal">
            <div className="setupModalHead"><div><span className="eyebrow">CONEXÃO MCP</span><h2>Conectar ao GPT</h2><p>Use o endpoint abaixo no plugin/cliente MCP do GPT. A chave é o segredo de acesso ao Core e pode ser revogada a qualquer momento.</p></div><button className="iconClose" onClick={()=>{setMcpOpen(false);setMcpMessage("");setMcpShowKey(false);}} aria-label="Fechar">×</button></div>
            {localConnection ? <>
              <div className="mcpConnectionHero"><span className="eyebrow">ENDPOINT PRONTO</span><code>{`${localConnection.coreUrl.replace(/\/$/,"")}/mcp`}</code><div className="inlineActions"><button className="primary" onClick={()=>void copyMcpValue("url")}>{mcpCopied==="url"?"✓ Link copiado":"Copiar link MCP"}</button><button className="secondary" onClick={()=>void copyMcpValue("bundle")}>{mcpCopied==="bundle"?"✓ Conexão copiada":"Copiar conexão para GPT"}</button></div></div>
              <div className="mcpKeyCard"><div><span className="eyebrow">CHAVE DE ACESSO</span><strong>{mcpShowKey?localConnection.appKey:`${localConnection.appKey.slice(0,8)}••••••••••••••••••••${localConnection.appKey.slice(-6)}`}</strong><small>Use como <b>Authorization: Bearer</b> quando o cliente solicitar autenticação.</small></div><div className="mcpKeyActions"><button className="secondary" onClick={()=>setMcpShowKey(value=>!value)}>{mcpShowKey?"Ocultar":"Mostrar"}</button><button className="secondary" onClick={()=>void copyMcpValue("key")}>{mcpCopied==="key"?"✓ Copiada":"Copiar chave"}</button></div></div>
              <div className="mcpSecurityBox"><div><strong>Rotação de segurança</strong><span>Ao gerar outra chave, a atual é substituída no Worker. A antiga deixa de autenticar novas chamadas MCP.</span></div><button className="dangerGhost" disabled={mcpRotateBusy} onClick={()=>void rotateMcpKey()}>{mcpRotateBusy?"Gerando…":"Revogar e gerar nova"}</button></div>
              {mcpMessage&&<div className={mcpMessage.startsWith("Chave anterior")?"notice compact":"formError"}>{mcpMessage}</div>}
            </> : <div className="mcpDisconnected"><strong>Conexão local não encontrada</strong><p>A chave MCP nunca é salva no D1. Para recuperar o acesso com segurança, reconecte a infraestrutura usando seu API Token Cloudflare; uma nova chave será criada automaticamente.</p><button className="primary" onClick={()=>{setMcpOpen(false);openInfrastructureSetup(Boolean(infraProfile));}}>Reconectar infraestrutura</button></div>}
          </div>
        </div>}

        {setupOpen && <div className="setupOverlay" role="dialog" aria-modal="true" aria-label="Configurar infraestrutura">
          <div className="setupModal">
            <div className="setupModalHead"><div><span className="eyebrow">CONFIGURAÇÃO AUTOSSUFICIENTE</span><h2>{infraProfile && !infraEditing ? "Corvo Library já configurada" : infraProfile ? "Alterar configuração" : "Conectar a Corvo Library"}</h2><p>{infraProfile && !infraEditing ? `A revisão ${infraProfile.revision} está travada. Abrir o app ou publicar uma nova versão não muda nada.` : "Tudo acontece aqui dentro. Nada para instalar no computador e nenhuma variável manual na hospedagem."}</p></div><button className="iconClose" onClick={() => {setSetupOpen(false);setInfraEditing(false);setInfraMessage("");setSetupAdvanced(false);setCloudflareToken("");}} aria-label="Fechar">×</button></div>

            <div className="quickSetupStatus">
              <div className={localConnection || infraProfile ? "done" : "current"}><b>1</b><span>Acesso Cloudflare</span><small>{localConnection || infraProfile ? "Conexão conhecida" : "Cole o API Token uma vez"}</small></div>
              <div className={health?.core.ok ? "done" : localConnection ? "current" : "waiting"}><b>2</b><span>Configuração automática</span><small>{health?.core.ok ? "D1 + R2 + Queue + Worker OK" : "A Library cria/verifica tudo"}</small></div>
              <div className={health?.core.ok && infraProfile ? "done" : "waiting"}><b>3</b><span>Gravado</span><small>{infraProfile ? `LOCKED · revisão ${infraProfile.revision}` : "Persistente nas próximas versões"}</small></div>
            </div>

            {infraProfile && !infraEditing ? <div className="lockedHero"><div><span>CONFIGURAÇÃO PERSISTENTE</span><strong>🔒 LOCKED · REVISÃO {infraProfile.revision}</strong><small>Instância {infraProfile.instanceId} · nada é redefinido por atualização.</small></div><div className="lockedActions">{health?.core.version && health.core.version !== EXPECTED_CORE_VERSION && <button className="secondary" disabled={coreUpdateBusy} onClick={()=>void updateCoreFromApp()}>{coreUpdateBusy ? "Atualizando…" : `Atualizar Core ${EXPECTED_CORE_VERSION}`}</button>}<button className="secondary" disabled={setupBusy} onClick={()=>void recheckInfrastructure()}>{setupBusy ? "Verificando…" : "Verificar agora"}</button><button className="primary" onClick={()=>{setInfraEditing(true);setCloudflareToken("");setAutoSetupStage("");}}>Alterar configuração</button></div></div> : <>
              <div className="selfSetupCard">
                <div className="selfSetupCopy"><span className="eyebrow">ÚNICA ENTRADA NECESSÁRIA</span><h3>API Token da Cloudflare</h3><p>Use um API Token da sua conta. Ele é usado pelo setup e depois fica guardado como <b>secret do próprio Worker</b>. Não é salvo no D1, não fica em variável da hospedagem e é removido do campo ao terminar.</p><div className="tokenPermissions"><b>Permissões do token</b><span>Workers Scripts Write · D1 Write · Workers R2 Storage Write · Queues Write</span><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Abrir criação de API Token na Cloudflare ↗</a></div></div>
                <label className="tokenField"><span>API Token</span><input type="password" autoComplete="off" value={cloudflareToken} onChange={(event:ChangeEvent<HTMLInputElement>)=>setCloudflareToken(event.target.value)} placeholder="Cole aqui o token da Cloudflare" /></label>
                <label className="tokenField"><span>Account ID <small>Cloudflare → R2/Workers → Account ID</small></span><input value={cloudflareAccountId} onChange={(event:ChangeEvent<HTMLInputElement>)=>setCloudflareAccountId(event.target.value.trim())} placeholder="32 caracteres · pode ficar salvo como identificador não secreto" /></label>
                {cloudflareAccounts.length>0 && <label className="tokenField"><span>Conta Cloudflare</span><select value={cloudflareAccountId} onChange={(event:ChangeEvent<HTMLSelectElement>)=>setCloudflareAccountId(event.target.value)}><option value="">Selecione a conta</option>{cloudflareAccounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
                <div className="autoResourceLine"><span><b>D1</b>{infraDraft.d1DatabaseName}</span><span><b>R2 existente</b>{infraDraft.r2BucketName}</span><span><b>Queue</b>{infraDraft.queueName}</span><span><b>Worker</b>{infraDraft.workerName}</span></div>
                <button className="primary autoSetupButton" disabled={autoSetupBusy || !cloudflareToken.trim()} onClick={()=>void runAutomaticSetup()}>{autoSetupBusy ? "Configurando…" : infraProfile ? "Aplicar alteração automaticamente" : "Configurar tudo automaticamente"}</button>
                <div className="setupPrivacy"><strong>Sem instalação local</strong><span>O catálogo de restauração já acompanha o app. O bucket <b>corvoquiz-prod</b> é reutilizado; a Library não copia as mídias nem pede Access Key/Secret do R2.</span></div>
                {autoSetupStage && <div className="autoSetupStage">{autoSetupBusy && <i />}<span>{autoSetupStage}</span></div>}
              </div>
            </>}

            <div className="bindingSummary">
              <div className={health?.core.d1 === "ok" ? "ok" : "pending"}><b>D1</b><span>{infraProfile?.d1DatabaseName || localConnection?.d1DatabaseName || defaultInfrastructureDraft.d1DatabaseName}</span><em>{health?.core.d1 || "aguardando"}</em></div>
              <div className={health?.core.r2 === "ok" ? "ok" : "pending"}><b>R2</b><span>{infraProfile?.r2BucketName || localConnection?.r2BucketName || defaultInfrastructureDraft.r2BucketName}</span><em>{health?.core.r2 || "aguardando"}</em></div>
              <div className={health?.core.queue === "ok" ? "ok" : "pending"}><b>QUEUE</b><span>{infraProfile?.queueName || localConnection?.queueName || defaultInfrastructureDraft.queueName}</span><em>{health?.core.queue || "aguardando"}</em></div>
              <div className={health?.core.control === "ok" && health?.core.appAuth === "ok" ? "ok" : "pending"}><b>CONTROLE</b><span>Secrets no Worker</span><em>{health?.core.control === "ok" && health?.core.appAuth === "ok" ? "ok" : "aguardando"}</em></div>
            </div>

            <div className="quickFinal">
              <div><span>ESTADO</span><strong className={health?.core.ok && infraProfile ? "okState" : "waitState"}>{health?.core.ok && infraProfile ? "PRONTO E CRAVADO" : autoSetupBusy ? "CONFIGURANDO" : coreState}</strong><small>{infraMessage || health?.core.error || (infraProfile ? "Nada muda até você clicar em Alterar configuração." : "Cole o token e toque em Configurar tudo automaticamente.")}</small></div>
              {infraProfile && !infraEditing ? <button className="secondary finalButton" disabled={setupBusy} onClick={()=>void recheckInfrastructure()}>{setupBusy ? "Verificando…" : "Verificar saúde"}</button> : <button className="primary finalButton" disabled={autoSetupBusy || !cloudflareToken.trim()} onClick={()=>void runAutomaticSetup()}>{autoSetupBusy ? "Configurando…" : "Configurar e gravar"}</button>}
            </div>

            <button className="advancedToggle" onClick={()=>setSetupAdvanced(value=>!value)}>{setupAdvanced ? "Ocultar opções avançadas" : "Opções avançadas"}</button>
            {setupAdvanced && <div className="persistBox advancedBox">
              <div className="persistHead"><div><span>RECURSOS CLOUDFLARE</span><strong>{infraProfile ? `REV ${infraProfile.revision}` : "PADRÕES RECOMENDADOS"}</strong></div></div>
              <div className="infraFields">{([
                ["workerName","Worker"],["d1DatabaseName","D1"],["r2BucketName","R2 bucket"],["queueName","Queue"],["dlqName","DLQ"]
              ] as Array<[keyof InfrastructureDraft,string]>).map(([field,label])=><label key={field}><span>{label}</span><input disabled={Boolean(infraProfile) && !infraEditing} value={infraDraft[field]} onChange={(event:ChangeEvent<HTMLInputElement>)=>updateInfraDraft(field,event.target.value)} /></label>)}</div>
              <div className="advancedHelp"><button className="secondary" onClick={copyInfrastructureChecklist}>{setupCopied ? "✓ Resumo copiado" : "Copiar resumo técnico"}</button>{localConnection && <button className="dangerGhost" onClick={forgetBrowserConnection}>Remover conexão só deste navegador</button>}</div>
              <p className="advancedWarning">Remover a conexão local não apaga D1, R2, Queue ou Worker. Para reconectar, basta voltar aqui e usar um API Token Cloudflare novamente.</p>
            </div>}
          </div>
        </div>}

      </div>
    </section>
  </main>;
}
