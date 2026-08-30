import type { Env } from "../types";
import { catalogStats, listAssets, listUniverses } from "./assets";
import { listAutomaticProjects } from "./projects";
import { listOperations } from "./operations";
import { dispatcherHealth } from "./workers";
import { getMaterializationStats } from "./materialization";
import { supervisorPanel } from "./supervisor";
import { stockPanel } from "./stock";
import { policyTelemetry, policyWorkspace } from "./policies";
import { bindingStatus, listSafeSettings } from "./settings";
import { getInfrastructureProfile } from "./infrastructure";

function limited(value: string | null, fallback: number, max: number) {
  return Math.max(1, Math.min(Number(value || fallback), max));
}

export async function uiOverviewSnapshot(env: Env) {
  const [stats, projects, operations] = await Promise.all([
    catalogStats(env),
    listAutomaticProjects(env, 12),
    listOperations(env, 12),
  ]);
  return { view:"overview", stats, projects, operations };
}

export async function uiAssetsSnapshot(request: Request, env: Env) {
  const incoming = new URL(request.url);
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/assets";
  assetUrl.searchParams.set("limit", String(limited(incoming.searchParams.get("limit"), 36, 50)));
  const assetRequest = new Request(assetUrl.toString(), { method:"GET", headers:request.headers });
  const includeFacets = ["1","true","yes"].includes(String(incoming.searchParams.get("facets") || "").toLowerCase());
  const [catalog, stats, universes] = await Promise.all([
    listAssets(assetRequest, env),
    includeFacets ? catalogStats(env) : Promise.resolve(null),
    includeFacets ? listUniverses(env) : Promise.resolve(null),
  ]);
  return { view:"assets", catalog, stats, universes };
}

export async function uiProjectsSnapshot(request: Request, env: Env) {
  const url = new URL(request.url);
  const page = await listAutomaticProjects(env, limited(url.searchParams.get("limit"), 100, 100), url.searchParams.get("cursor"));
  return { view:"projects", ...page };
}

export async function uiExecutionsSnapshot(env: Env) {
  const [operations, workers, materialization, supervisor] = await Promise.all([
    listOperations(env, 25),
    dispatcherHealth(env),
    getMaterializationStats(env),
    supervisorPanel(env),
  ]);
  return { view:"executions", operations, workers, materialization, supervisor };
}

export async function uiAnalysisSnapshot(env: Env, includePolicies = false) {
  const [stock, workspace, telemetry] = await Promise.all([
    stockPanel(env),
    includePolicies ? policyWorkspace(env) : Promise.resolve(null),
    includePolicies ? policyTelemetry(env) : Promise.resolve(null),
  ]);
  return { view:"analysis", stock, policyWorkspace:workspace, policyTelemetry:telemetry };
}

export async function uiSettingsSnapshot(env: Env) {
  const [settings, bindings, infrastructure] = await Promise.all([
    listSafeSettings(env),
    bindingStatus(env),
    getInfrastructureProfile(env),
  ]);
  return { view:"settings", settings, bindings, infrastructure };
}
