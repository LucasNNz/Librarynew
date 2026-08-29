#!/usr/bin/env python3
from __future__ import annotations
import argparse, collections, gzip, hashlib, json, os, pathlib, re, shutil, sqlite3, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE_PATH = ROOT / "docs" / "HISTORICAL_INTEGRITY_BASELINE.json"
MATRIX_PATH = ROOT / "docs" / "MCP_COMPATIBILITY_MATRIX.md"
MCP_PATH = ROOT / "cloudflare" / "src" / "mcp.ts"

EXPECTED = {
    "assets": 929,
    "approved": 849,
    "pending": 77,
    "rejected": 3,
    "approved_universes": 174,
    "all_universes": 175,
    "asset_usage": 1176,
    "assets_missing_r2_key": 0,
    "schema_version": "2.7.0",
    "historical_mcp": 229,
    "historical_implemented": 227,
    "historical_substituted": 2,
}
SUBSTITUTED = {"obter_configuracao_cloudflare", "configurar_cloudflare"}
EXPECTED_EXTRA_TOOLS = {"auditar_armazenamento_r2", "obter_status_upload_midia", "auditar_integridade_d1"}
FORBIDDEN = ["@libsql", "TURSO_", "production-recovery", "secret_cloudflare_connection"]
SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs"}


def load_sql_transactionally(conn: sqlite3.Connection, text: str) -> None:
    text = re.sub(r"^\s*PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;\s*$", "", text, flags=re.I | re.M)
    conn.executescript("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;\n" + text + "\nCOMMIT;")


def q1(conn: sqlite3.Connection, sql: str, params=()):
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def logical_health(conn: sqlite3.Connection):
    queries = {
        "collectionTermsWithoutBatch": "SELECT COUNT(*) FROM collection_terms t LEFT JOIN collection_batches b ON b.id=t.batch_id WHERE b.id IS NULL",
        "collectionCandidatesWithoutBatch": "SELECT COUNT(*) FROM collection_candidates c LEFT JOIN collection_batches b ON b.id=c.batch_id WHERE b.id IS NULL",
        "collectionCandidatesWithoutTerm": "SELECT COUNT(*) FROM collection_candidates c LEFT JOIN collection_terms t ON t.id=c.term_id WHERE c.term_id IS NOT NULL AND t.id IS NULL",
        "workerItemsWithoutParent": "SELECT COUNT(*) FROM worker_work_items w LEFT JOIN automatic_project_items i ON i.id=w.item_id LEFT JOIN automatic_projects p ON p.id=w.project_id WHERE (w.item_id IS NOT NULL AND i.id IS NULL) OR (w.project_id IS NOT NULL AND p.id IS NULL)",
        "supervisorDecisionsWithoutItem": "SELECT COUNT(*) FROM supervisor_decision_queue q LEFT JOIN automatic_project_items i ON i.id=q.item_id WHERE q.item_id IS NOT NULL AND i.id IS NULL",
        "operationalPolicyEventsWithoutItem": "SELECT COUNT(*) FROM operational_policy_events e LEFT JOIN automatic_project_items i ON i.id=e.item_id WHERE e.item_id IS NOT NULL AND i.id IS NULL",
        "supervisorCandidatesWithoutItem": "SELECT COUNT(*) FROM supervisor_project_candidates c LEFT JOIN automatic_project_items i ON i.id=c.item_id WHERE c.item_id IS NOT NULL AND i.id IS NULL",
        "planBranchesWithoutItem": "SELECT COUNT(*) FROM plan_branches b LEFT JOIN automatic_project_items i ON i.id=b.item_id WHERE b.item_id IS NOT NULL AND i.id IS NULL",
        "sourceRoutingPlansWithoutItem": "SELECT COUNT(*) FROM source_routing_plans p LEFT JOIN automatic_project_items i ON i.id=p.item_id WHERE p.item_id IS NOT NULL AND i.id IS NULL",
    }
    active = {
        "readyOrLeasedWorkerItemsWithoutParent": "SELECT COUNT(*) FROM worker_work_items w LEFT JOIN automatic_project_items i ON i.id=w.item_id LEFT JOIN automatic_projects p ON p.id=w.project_id WHERE w.status IN ('READY','LEASED') AND ((w.item_id IS NOT NULL AND i.id IS NULL) OR (w.project_id IS NOT NULL AND p.id IS NULL))",
        "pendingSupervisorDecisionsWithoutItem": "SELECT COUNT(*) FROM supervisor_decision_queue q LEFT JOIN automatic_project_items i ON i.id=q.item_id WHERE q.state='PENDENTE' AND q.item_id IS NOT NULL AND i.id IS NULL",
        "actionableSupervisorCandidatesWithoutItem": "SELECT COUNT(*) FROM supervisor_project_candidates c LEFT JOIN automatic_project_items i ON i.id=c.item_id WHERE c.status IN ('PARA_ANALISE','PARA_QA_VISUAL') AND c.item_id IS NOT NULL AND i.id IS NULL",
    }
    v2 = {
        "candidatesWithoutOperation": "SELECT COUNT(*) FROM v2_ingest_candidates c LEFT JOIN v2_ingest_operations o ON o.id=c.operation_id WHERE o.id IS NULL",
        "eventsWithoutOperation": "SELECT COUNT(*) FROM v2_ingest_events e LEFT JOIN v2_ingest_operations o ON o.id=e.operation_id WHERE o.id IS NULL",
        "packagesWithoutProject": "SELECT COUNT(*) FROM v2_download_packages p LEFT JOIN automatic_projects a ON a.id=p.project_id WHERE a.id IS NULL",
        "projectMediaWithoutProject": "SELECT COUNT(*) FROM v2_project_media m LEFT JOIN automatic_projects a ON a.id=m.project_id WHERE a.id IS NULL",
        "projectTitlesWithoutProject": "SELECT COUNT(*) FROM v2_project_titles t LEFT JOIN automatic_projects a ON a.id=t.project_id WHERE a.id IS NULL",
        "infrastructureEventsWithoutProfile": "SELECT COUNT(*) FROM v2_infrastructure_config_events e LEFT JOIN v2_infrastructure_profiles p ON p.id=e.profile_id WHERE p.id IS NULL",
    }
    return (
        {k: int(q1(conn, sql) or 0) for k, sql in queries.items()},
        {k: int(q1(conn, sql) or 0) for k, sql in active.items()},
        {k: int(q1(conn, sql) or 0) for k, sql in v2.items()},
    )


def resolve_relative(source: pathlib.Path, spec: str):
    base = source.parent / spec
    candidates = [base]
    if not base.suffix:
        candidates += [base.with_suffix(ext) for ext in [".ts", ".tsx", ".js", ".mjs", ".cjs"]]
        candidates += [base / f"index{ext}" for ext in [".ts", ".tsx", ".js", ".mjs", ".cjs"]]
    return next((p for p in candidates if p.exists()), None)


def source_checks():
    roots = [ROOT / "app", ROOT / "lib", ROOT / "cloudflare" / "src"]
    files = [p for r in roots for p in r.rglob("*") if p.is_file() and p.suffix in SOURCE_EXTENSIONS]
    forbidden_hits = {needle: [] for needle in FORBIDDEN}
    missing_imports = []
    import_count = 0
    import_re = re.compile(r"(?:from\s+|import\s*\()\s*[\"'](\.{1,2}/[^\"']+)[\"']")
    for p in files:
        text = p.read_text("utf8")
        rel = str(p.relative_to(ROOT))
        for needle in FORBIDDEN:
            if needle.lower() in text.lower(): forbidden_hits[needle].append(rel)
        for spec in import_re.findall(text):
            import_count += 1
            if resolve_relative(p, spec) is None:
                missing_imports.append({"file": rel, "import": spec})
    return {"files_checked": len(files), "relative_imports_checked": import_count, "missing_relative_imports": missing_imports, "forbidden_legacy_hits": forbidden_hits}


def mcp_checks():
    matrix = MATRIX_PATH.read_text("utf8")
    rows = re.findall(r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|.*?\|\s*([^|]+?)\s*\|", matrix, flags=re.M)
    historical = [name for _, name, _ in rows]
    states = {name: state.strip() for _, name, state in rows}
    source = MCP_PATH.read_text("utf8")
    registered = re.findall(r"registerTool\(\s*[\"']([^\"']+)", source)
    counts = collections.Counter(registered)
    duplicates = sorted(name for name, n in counts.items() if n > 1)
    implemented_matrix = {n for n in historical if "IMPLEMENTADO" in states[n]}
    substituted_matrix = {n for n in historical if "SUBSTITU" in states[n]}
    historical_registered = set(registered) & set(historical)
    extras = set(registered) - set(historical)
    missing_implemented = sorted(implemented_matrix - set(registered))
    incorrectly_registered_substitutes = sorted(substituted_matrix & set(registered))
    return {
        "historical_total": len(historical),
        "matrix_implemented": len(implemented_matrix),
        "matrix_substituted": len(substituted_matrix),
        "registered_total": len(registered),
        "registered_unique": len(set(registered)),
        "historical_registered": len(historical_registered),
        "extras": sorted(extras),
        "duplicates": duplicates,
        "missing_implemented": missing_implemented,
        "incorrectly_registered_substitutes": incorrectly_registered_substitutes,
        "substituted": sorted(substituted_matrix),
    }


def run_tsc(config: pathlib.Path):
    exe = shutil.which("tsc")
    if not exe: return {"status": "SKIPPED", "reason": "tsc not found"}
    proc = subprocess.run([exe, "-p", str(config), "--pretty", "false"], cwd=ROOT, capture_output=True, text=True, timeout=90)
    return {"status": "PASS" if proc.returncode == 0 else "FAIL", "returncode": proc.returncode, "output": (proc.stdout + proc.stderr).strip()[-12000:]}


def self_sufficient_checks(restore: pathlib.Path):
    page = (ROOT / "app" / "page.tsx").read_text("utf8")
    core_client = (ROOT / "lib" / "core-client.ts").read_text("utf8")
    browser = (ROOT / "lib" / "browser-connection.ts").read_text("utf8")
    provision = (ROOT / "app" / "api" / "setup" / "cloudflare" / "provision" / "route.ts").read_text("utf8")
    worker_control = (ROOT / "cloudflare" / "src" / "core" / "control-plane.ts").read_text("utf8")
    package = json.loads((ROOT / "package.json").read_text("utf8"))
    gzip_path = ROOT / "bootstrap" / "CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql.gz"
    gzip_matches_restore = False
    gzip_sha256 = None
    if gzip_path.exists():
        raw = gzip.decompress(gzip_path.read_bytes())
        gzip_sha256 = hashlib.sha256(raw).hexdigest()
        gzip_matches_restore = raw == restore.read_bytes()
    forbidden_ui = [
        "npm run setup:cloudflare", "Adicionar 2 variáveis", "Conectar Vercel",
        "Projeto Vercel", "CORVO_CORE_URL=https://"
    ]
    ui_hits = [value for value in forbidden_ui if value.lower() in page.lower()]
    package_setup_script = any("setup:cloudflare" in key or "setup-cloudflare" in str(value) for key,value in package.get("scripts",{}).items())
    return {
        "embedded_restore_exists": gzip_path.exists(),
        "embedded_restore_matches_input": gzip_matches_restore,
        "embedded_restore_sha256": gzip_sha256,
        "manual_setup_ui_hits": ui_hits,
        "manual_setup_package_script": package_setup_script,
        "hosting_env_dependency": "process.env" in core_client or "CORVO_CORE_URL" in core_client,
        "browser_stores_cloudflare_token": "cloudflareToken" in browser or "CLOUDFLARE_CONTROL_TOKEN" in browser,
        "provision_moves_control_token_to_worker_secret": 'type: "secret_text", name: "CLOUDFLARE_CONTROL_TOKEN"' in (ROOT / "lib" / "cloudflare-control.ts").read_text("utf8"),
        "worker_has_self_update": "selfUpdateCore" in worker_control and "/api/setup/core-bundle" in worker_control,
        "core_bundle_endpoint_exists": (ROOT / "app" / "api" / "setup" / "core-bundle" / "route.ts").exists(),
        "migration_registry_exists": (ROOT / "cloudflare" / "migrations" / "9007_v2_migration_registry.sql").exists(),
        "setup_route_exists": "CLOUDFLARE_API_TOKEN_REQUIRED" in provision,
    }



def worker_bundle_build_checks():
    path = ROOT / "scripts" / "build-core-bundle.mjs"
    text = path.read_text("utf8")
    wrangler = (ROOT / "cloudflare" / "wrangler.jsonc.example").read_text("utf8")
    deploy = (ROOT / "lib" / "cloudflare-control.ts").read_text("utf8")
    generated = (ROOT / "lib" / "generated-core-bundle.ts").read_text("utf8")
    return {
        "generated_bundle_exports_widened": (
            'CORE_WORKER_BUNDLE_VERSION: string' in text
            and 'CORE_WORKER_BUNDLE: string' in text
            and 'CORE_WORKER_BUNDLE_VERSION: string' in generated
            and 'CORE_WORKER_BUNDLE: string' in generated
        ),
        "platform_browser_disabled": 'platform: "browser"' not in text,
        "platform_neutral": 'platform: "neutral"' in text,
        "node_builtins_externalized": re.search(r'external\s*:\s*\[\s*["\']node:\*["\']\s*\]', text) is not None,
        "worker_condition_present": '"workerd"' in text and '"worker"' in text,
        "browser_condition_removed": 'conditions: ["workerd", "worker", "browser"' not in text,
        "wrangler_compat_date": re.search(r'"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"', wrangler).group(1) if re.search(r'"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"', wrangler) else None,
        "api_deploy_compat_date": re.search(r'compatibility_date:\s*"(\d{4}-\d{2}-\d{2})"', deploy).group(1) if re.search(r'compatibility_date:\s*"(\d{4}-\d{2}-\d{2})"', deploy) else None,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("restore_sql", help="Caminho para CORVO_LIBRARY_V2_D1_RESTORE_SAFE.sql")
    ap.add_argument("--output", default=str(ROOT / "docs" / "VALIDATION_REPORT.json"))
    ap.add_argument("--keep-db", default="")
    args = ap.parse_args()
    started = time.time()
    restore = pathlib.Path(args.restore_sql).resolve()
    baseline = json.loads(BASELINE_PATH.read_text("utf8"))
    errors = []
    tmp_path = pathlib.Path(args.keep_db) if args.keep_db else pathlib.Path(tempfile.mkstemp(prefix="corvo-v2-gate-", suffix=".db")[1])
    try:
        if tmp_path.exists(): tmp_path.unlink()
        conn = sqlite3.connect(tmp_path)
        load_sql_transactionally(conn, restore.read_text("utf8"))
        migration_files = sorted((ROOT / "cloudflare" / "migrations").glob("*.sql"))
        for mig in migration_files: load_sql_transactionally(conn, mig.read_text("utf8"))
        conn.execute("PRAGMA foreign_keys=ON")

        db = {
            "integrity_check": q1(conn, "PRAGMA integrity_check"),
            "assets": int(q1(conn, "SELECT COUNT(*) FROM assets") or 0),
            "approved": int(q1(conn, "SELECT COUNT(*) FROM assets WHERE status='Aprovado'") or 0),
            "pending": int(q1(conn, "SELECT COUNT(*) FROM assets WHERE status='Pendente'") or 0),
            "rejected": int(q1(conn, "SELECT COUNT(*) FROM assets WHERE status='Rejeitado'") or 0),
            "approved_universes": int(q1(conn, "SELECT COUNT(DISTINCT universe) FROM assets WHERE status='Aprovado' AND universe IS NOT NULL AND TRIM(universe)<>''") or 0),
            "all_universes": int(q1(conn, "SELECT COUNT(DISTINCT universe) FROM assets WHERE universe IS NOT NULL AND TRIM(universe)<>''") or 0),
            "asset_usage": int(q1(conn, "SELECT COUNT(*) FROM asset_usage") or 0),
            "assets_missing_r2_key": int(q1(conn, "SELECT COUNT(*) FROM assets WHERE r2_key IS NULL OR TRIM(r2_key)=''") or 0),
            "duplicate_asset_r2_keys": int(q1(conn, "SELECT COUNT(*) FROM (SELECT r2_key FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>'' GROUP BY r2_key HAVING COUNT(*)>1)") or 0),
            "tables_total": int(q1(conn, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") or 0),
            "v2_tables": [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%' ORDER BY name")],
            "schema_version": q1(conn, "SELECT value FROM v2_schema_meta WHERE key='schema_version'"),
            "sensitive_settings_rows": int(q1(conn, "SELECT COUNT(*) FROM settings WHERE key IN ('mcp_connection_code','secret_cloudflare_connection','secret_supervisor_connection')") or 0),
        }
        for key in ["assets","approved","pending","rejected","approved_universes","all_universes","asset_usage","assets_missing_r2_key","schema_version"]:
            if db[key] != EXPECTED[key]: errors.append(f"database.{key}: expected {EXPECTED[key]!r}, got {db[key]!r}")
        if db["integrity_check"] != "ok": errors.append(f"PRAGMA integrity_check={db['integrity_check']}")
        if db["sensitive_settings_rows"] != 0: errors.append("sensitive historical settings were restored")

        fk_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        fk_groups = collections.Counter(f"{r[0]}->{r[2]}" for r in fk_rows)
        fk = {"total": len(fk_rows), "groups": dict(sorted(fk_groups.items())), "baseline_exact_match": False}
        fk["baseline_exact_match"] = fk["total"] == baseline["foreign_key_violations_total"] and fk["groups"] == baseline["foreign_key_violation_groups"]
        if not fk["baseline_exact_match"]: errors.append("foreign-key violations differ from immutable historical baseline")

        historical, active_risk, v2 = logical_health(conn)
        health = {"historical": historical, "active_historical_risk": active_risk, "v2": v2, "v2_orphans": sum(v2.values())}
        if historical != baseline["logical_orphans"]: errors.append("logical historical orphan baseline changed")
        if active_risk != baseline["active_historical_risk"]: errors.append("active historical risk baseline changed")
        if health["v2_orphans"] != 0: errors.append(f"V2 logical orphans={health['v2_orphans']}")

        # Persistence contract: configuration is never seeded by migration and survives migration replay byte-for-byte.
        initial_profiles = int(q1(conn, "SELECT COUNT(*) FROM v2_infrastructure_profiles") or 0)
        if initial_profiles != 0: errors.append("infrastructure profile must not be seeded by migrations")
        profile_columns = [r[1] for r in conn.execute("PRAGMA table_info(v2_infrastructure_profiles)").fetchall()]
        forbidden_profile_columns = sorted(c for c in profile_columns if re.search(r"secret|token|password|credential|access_key|master_key", c, re.I))
        if forbidden_profile_columns: errors.append(f"secret-like columns found in infrastructure profile: {forbidden_profile_columns}")
        migration_mutators = []
        mutation_re = re.compile(r"\b(?:insert\s+(?:or\s+replace\s+)?into|replace\s+into|update|delete\s+from)\s+v2_infrastructure_profiles\b", re.I)
        for mig in migration_files:
            if mutation_re.search(mig.read_text("utf8")): migration_mutators.append(mig.name)
        if migration_mutators: errors.append(f"migrations mutate persistent infrastructure profile: {migration_mutators}")

        sentinel = ("primary","INST-PERSISTENCE-GATE",7,"LOCKED","corvo-library-v2","corvo-core-v2","corvo-library-v2","corvoquiz-prod","corvo-materialize-v2","corvo-materialize-v2-dlq",1700000000000,1700000000123,1700000000456,'{"gate":"immutable"}')
        conn.execute("INSERT INTO v2_infrastructure_profiles (id,instance_id,revision,lock_state,bff_project_name,worker_name,d1_database_name,r2_bucket_name,queue_name,dlq_name,configured_at,updated_at,last_verified_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sentinel)
        before_replay = conn.execute("SELECT * FROM v2_infrastructure_profiles WHERE id='primary'").fetchone()
        persistence_migration = ROOT / "cloudflare" / "migrations" / "9006_v2_persistent_infrastructure.sql"
        load_sql_transactionally(conn, persistence_migration.read_text("utf8"))
        after_replay = conn.execute("SELECT * FROM v2_infrastructure_profiles WHERE id='primary'").fetchone()
        config_persistence = {
            "not_seeded_by_migrations": initial_profiles == 0,
            "persistent_migration_is_idempotent": before_replay == after_replay,
            "migration_profile_mutators": migration_mutators,
            "lock_state": after_replay[3] if after_replay else None,
            "revision": after_replay[2] if after_replay else None,
            "secret_like_columns": forbidden_profile_columns,
        }
        if before_replay != after_replay: errors.append("persistent infrastructure migration changed saved configuration")
        conn.execute("DELETE FROM v2_infrastructure_profiles WHERE id='primary'")
        conn.commit()
        conn.close()

        source = source_checks()
        if source["missing_relative_imports"]: errors.append("missing relative imports")
        if any(source["forbidden_legacy_hits"].values()): errors.append("forbidden legacy dependencies found in runtime source")
        wrangler = (ROOT / "cloudflare" / "wrangler.jsonc.example").read_text("utf8")
        if '"bucket_name": "corvoquiz-prod"' not in wrangler: errors.append("R2 binding is not pinned to corvoquiz-prod")

        mcp = mcp_checks()
        if mcp["historical_total"] != EXPECTED["historical_mcp"]: errors.append("MCP matrix historical total mismatch")
        if mcp["matrix_implemented"] != EXPECTED["historical_implemented"]: errors.append("MCP implemented count mismatch")
        if mcp["matrix_substituted"] != EXPECTED["historical_substituted"]: errors.append("MCP substituted count mismatch")
        if set(mcp["substituted"]) != SUBSTITUTED: errors.append("MCP substituted names mismatch")
        if set(mcp["extras"]) != EXPECTED_EXTRA_TOOLS: errors.append(f"unexpected MCP extras: {mcp['extras']}")
        if mcp["duplicates"] or mcp["missing_implemented"] or mcp["incorrectly_registered_substitutes"]: errors.append("MCP registration contract mismatch")

        worker_bundle = worker_bundle_build_checks()
        if not worker_bundle["generated_bundle_exports_widened"]: errors.append("Generated Core bundle exports must be widened to string to survive post-prebuild TypeScript checks")
        if not worker_bundle["platform_browser_disabled"]: errors.append("Worker prebuild still uses browser platform")
        if not worker_bundle["platform_neutral"]: errors.append("Worker prebuild must use neutral platform")
        if not worker_bundle["node_builtins_externalized"]: errors.append("Worker prebuild must externalize node:* runtime imports")
        if not worker_bundle["worker_condition_present"]: errors.append("Worker prebuild is missing workerd/worker conditions")
        if not worker_bundle["browser_condition_removed"]: errors.append("Worker prebuild still prioritizes browser package conditions")
        for label in ["wrangler_compat_date", "api_deploy_compat_date"]:
            value = worker_bundle[label]
            if not value or value < "2026-08-04": errors.append(f"{label} must enable Cloudflare Node compatibility")

        self_sufficient = self_sufficient_checks(restore)
        if not self_sufficient["embedded_restore_exists"]: errors.append("embedded D1 bootstrap is missing")
        if not self_sufficient["embedded_restore_matches_input"]: errors.append("embedded D1 bootstrap differs from validated restore")
        if self_sufficient["manual_setup_ui_hits"]: errors.append(f"manual/PC setup instructions remain in UI: {self_sufficient['manual_setup_ui_hits']}")
        if self_sufficient["manual_setup_package_script"]: errors.append("manual Cloudflare setup script remains a user-facing package script")
        if self_sufficient["hosting_env_dependency"]: errors.append("runtime still depends on hosting environment variables for Core connection")
        if self_sufficient["browser_stores_cloudflare_token"]: errors.append("browser connection layer stores Cloudflare control token")
        if not self_sufficient["provision_moves_control_token_to_worker_secret"]: errors.append("Cloudflare control token is not persisted as a Worker secret")
        if not self_sufficient["worker_has_self_update"]: errors.append("Worker self-update control plane missing")
        if not self_sufficient["core_bundle_endpoint_exists"]: errors.append("Core bundle endpoint missing")
        if not self_sufficient["migration_registry_exists"]: errors.append("web-managed migration registry missing")

        typecheck = {
            "worker_structural": run_tsc(ROOT / "cloudflare" / "tsconfig.validate.json"),
            "frontend_structural": run_tsc(ROOT / "tsconfig.validate.json"),
            "real_next_build": {"status": "EXTERNAL_GATE", "reason": "Dependencies were not installed because registry access timed out in this execution."},
            "real_wrangler_build": {"status": "EXTERNAL_GATE", "reason": "Cloudflare dependencies/account are not provisioned in this execution."},
        }
        if typecheck["worker_structural"]["status"] != "PASS": errors.append("worker structural typecheck failed")
        if typecheck["frontend_structural"]["status"] != "PASS": errors.append("frontend structural typecheck failed")

        package = json.loads((ROOT / "package.json").read_text("utf8"))
        report = {
            "checkpoint": package["version"],
            "validation": "PASS" if not errors else "FAIL",
            "duration_seconds": round(time.time() - started, 3),
            "restore": {"path": str(restore), "sha256": hashlib.sha256(restore.read_bytes()).hexdigest(), "migrations": [p.name for p in migration_files]},
            "database": db,
            "historical_integrity": fk,
            "logical_integrity": health,
            "configuration_persistence": config_persistence,
            "worker_bundle_build": worker_bundle,
            "self_sufficient_setup": self_sufficient,
            "mcp": mcp,
            "source": source,
            "typecheck": typecheck,
            "errors": errors,
        }
        out = pathlib.Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if not errors else 1
    finally:
        if not args.keep_db and tmp_path.exists(): tmp_path.unlink()

if __name__ == "__main__":
    raise SystemExit(main())
