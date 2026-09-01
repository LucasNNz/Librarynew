import type { Env } from "../types";

export type D1RouteMetrics = {
  tool: string;
  startedAt: number;
  dbQueries: number;
  metaCoveredQueries: number;
  rowsReadObserved: number;
  rowsWrittenObserved: number;
  durationMs?: number;
  success?: boolean;
};

const statementNative = new WeakMap<object, object>();

function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function absorbMeta(metrics: D1RouteMetrics, result: any, coveredQueries = 1) {
  const meta = result?.meta;
  if (!meta) return;
  metrics.metaCoveredQueries += coveredQueries;
  metrics.rowsReadObserved += numeric(meta.rows_read ?? meta.rowsRead);
  metrics.rowsWrittenObserved += numeric(meta.rows_written ?? meta.rowsWritten ?? meta.changes);
}

function wrapStatement(statement: any, metrics: D1RouteMetrics): any {
  const proxy = new Proxy(statement, {
    get(target, prop, receiver) {
      if (prop === "bind") {
        return (...args: unknown[]) => wrapStatement(target.bind(...args), metrics);
      }
      if (prop === "all" || prop === "run") {
        return async (...args: unknown[]) => {
          metrics.dbQueries += 1;
          const result = await target[prop](...args);
          absorbMeta(metrics, result);
          return result;
        };
      }
      if (prop === "first" || prop === "raw") {
        return async (...args: unknown[]) => {
          metrics.dbQueries += 1;
          // D1 first()/raw() do not expose D1Result.meta. Query count remains exact;
          // rows_read_observed intentionally reports only queries whose meta is available.
          return target[prop](...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  statementNative.set(proxy, statement);
  return proxy;
}

export function createD1TelemetryEnv(env: Env, metrics: D1RouteMetrics): Env {
  const database = new Proxy(env.DB as any, {
    get(target, prop, receiver) {
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), metrics);
      if (prop === "batch") {
        return async (statements: any[]) => {
          const native = statements.map(statement => statementNative.get(statement) || statement);
          metrics.dbQueries += native.length;
          const results = await target.batch(native);
          for (const result of results || []) absorbMeta(metrics, result);
          return results;
        };
      }
      if (prop === "exec") {
        return async (sql: string) => {
          // exec may contain multiple statements; count conservatively from semicolon-separated SQL.
          metrics.dbQueries += Math.max(1, String(sql || "").split(";").filter(part => part.trim()).length);
          return target.exec(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(env as any, {
    get(target, prop, receiver) {
      if (prop === "DB") return database;
      return Reflect.get(target, prop, receiver);
    },
  }) as Env;
}

export async function detectMcpToolName(request: Request) {
  if (request.method !== "POST") return null;
  try {
    const payload: any = await request.clone().json();
    const entry = Array.isArray(payload) ? payload.find(item => item?.method === "tools/call") : payload;
    if (entry?.method !== "tools/call") return null;
    return String(entry?.params?.name || "unknown_tool");
  } catch {
    return null;
  }
}

export async function recordD1RouteTelemetry(env: Env, metrics: D1RouteMetrics) {
  const durationMs = Math.max(0, Number(metrics.durationMs || Date.now() - metrics.startedAt));
  try {
    await env.DB.prepare(`INSERT INTO v2_mcp_route_telemetry
      (id,tool,success,duration_ms,db_query_count,meta_covered_queries,rows_read_observed,rows_written_observed,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(
        `MRT-${crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`,
        metrics.tool,
        metrics.success === false ? 0 : 1,
        durationMs,
        metrics.dbQueries,
        metrics.metaCoveredQueries,
        metrics.rowsReadObserved,
        metrics.rowsWrittenObserved,
        Date.now(),
      ).run();
  } catch {
    // Telemetry must never make an operational MCP tool fail, including during the first boot
    // before migration 9027 has created the table.
  }
}
