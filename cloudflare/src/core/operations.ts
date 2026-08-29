import type { Env } from "../types";

export async function listOperations(env: Env, limit = 100, status?: string | null) {
  const safe = Math.max(1, Math.min(limit, 500));
  const result = status
    ? await env.DB.prepare("SELECT * FROM v2_ingest_operations WHERE status=? ORDER BY updated_at DESC LIMIT ?").bind(status, safe).all<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM v2_ingest_operations ORDER BY updated_at DESC LIMIT ?").bind(safe).all<Record<string, unknown>>();
  return result.results || [];
}

export async function latestOperation(env: Env, type?: string | null) {
  return type
    ? env.DB.prepare("SELECT * FROM v2_ingest_operations WHERE type=? ORDER BY updated_at DESC LIMIT 1").bind(type).first<Record<string, unknown>>()
    : env.DB.prepare("SELECT * FROM v2_ingest_operations ORDER BY updated_at DESC LIMIT 1").first<Record<string, unknown>>();
}

export async function mcpPerformance(env: Env, limit = 100) {
  const safe = Math.max(1, Math.min(limit, 1000));
  const [summary, tools, recent] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT COUNT(*) AS calls,SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes,SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) AS failures,AVG(duration_ms) AS avg_duration_ms,MAX(duration_ms) AS max_duration_ms,SUM(db_query_count) AS db_queries,SUM(r2_request_count) AS r2_requests,SUM(external_http_count) AS external_http FROM mcp_audit`),
    env.DB.prepare(`SELECT tool,COUNT(*) AS calls,AVG(duration_ms) AS avg_duration_ms,MAX(duration_ms) AS max_duration_ms,SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) AS failures FROM mcp_audit GROUP BY tool ORDER BY calls DESC LIMIT 100`),
    env.DB.prepare(`SELECT * FROM mcp_audit ORDER BY created_at DESC LIMIT ?`).bind(safe),
  ]);
  return { summary: summary.results?.[0] || {}, tools: tools.results || [], recent: recent.results || [] };
}

export async function sourceRouteRanking(env: Env, limit = 100) {
  const result = await env.DB.prepare(`SELECT source_id,source_name,host,universe,composition_class,attempts,materialized,approved,rejected,technical_failures,semantic_failures,total_duration_ms,score,updated_at FROM source_route_metrics ORDER BY score DESC,approved DESC,materialized DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 500))).all<Record<string, unknown>>();
  return result.results || [];
}

export async function operationalRisk(env: Env) {
  const [hosts, workers, gaps, policies, failedIngest] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN circuit_state='OPEN' THEN 1 ELSE 0 END) AS open FROM materialization_host_health"),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='LEASED' AND lease_expires_at < ? THEN 1 ELSE 0 END) AS expired FROM worker_work_items").bind(Date.now()),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) AS open,SUM(CASE WHEN status='OPEN' AND severity IN ('HIGH','CRITICAL') THEN 1 ELSE 0 END) AS severe FROM operational_gaps"),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('ACTIVE','PROMOTED','ATIVO') THEN 1 ELSE 0 END) AS active FROM operational_policies"),
    env.DB.prepare("SELECT COUNT(*) AS failed FROM v2_ingest_candidates WHERE status='FAILED' AND updated_at>? ").bind(Date.now() - 24 * 60 * 60_000),
  ]);
  const openCircuits = Number(hosts.results?.[0]?.open || 0);
  const expiredLeases = Number(workers.results?.[0]?.expired || 0);
  const severeGaps = Number(gaps.results?.[0]?.severe || 0);
  const recentFailures = Number(failedIngest.results?.[0]?.failed || 0);
  const score = openCircuits * 20 + expiredLeases * 10 + severeGaps * 15 + Math.min(recentFailures, 20) * 2;
  return { level: score >= 80 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW", score, signals: { openCircuits, expiredLeases, severeGaps, recentIngestFailures: recentFailures }, policies: policies.results?.[0] || {} };
}

export async function pipelineTelemetry(env: Env) {
  const [projects, workers, items, queues, stages, ingest] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT status,pipeline_status,COUNT(*) AS count FROM automatic_projects GROUP BY status,pipeline_status"),
    env.DB.prepare("SELECT status,worker_type,COUNT(*) AS count FROM worker_work_items GROUP BY status,worker_type"),
    env.DB.prepare("SELECT status,COUNT(*) AS count FROM automatic_project_items GROUP BY status"),
    env.DB.prepare("SELECT * FROM queue_snapshots ORDER BY captured_at DESC LIMIT 50"),
    env.DB.prepare("SELECT stage,result,COUNT(*) AS count,AVG(duration_ms) AS avg_duration_ms,AVG(queue_wait_ms) AS avg_queue_wait_ms FROM stage_metrics GROUP BY stage,result ORDER BY stage"),
    env.DB.prepare("SELECT status,COUNT(*) AS count,SUM(requested) AS requested,SUM(succeeded) AS succeeded,SUM(failed) AS failed FROM v2_ingest_operations GROUP BY status"),
  ]);
  return { projects: projects.results || [], workers: workers.results || [], projectItems: items.results || [], queueSnapshots: queues.results || [], stageMetrics: stages.results || [], ingest: ingest.results || [] };
}
