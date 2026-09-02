from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf-8')
package=json.loads(read('package.json'))
cfpackage=json.loads(read('cloudflare/package.json'))
page=read('app/page.tsx')
css=read('app/globals.css')
index=read('cloudflare/src/index.ts')
mcp=read('cloudflare/src/mcp.ts')
health_route=read('app/api/health/route.ts')
migrations_route=read('app/api/setup/migrations/route.ts')
contract=read('cloudflare/src/core/schema-contract.ts')
model=read('cloudflare/src/core/production-model.ts')
projects=read('cloudflare/src/core/projects.ts')
workers=read('cloudflare/src/core/workers.ts')
telemetry=read('cloudflare/src/core/d1-telemetry.ts')
bundle=read('lib/generated-core-bundle.ts')

# isolate verificar_saude to ensure it no longer calls catalogStats
start=mcp.index('server.registerTool("verificar_saude"')
end=mcp.index('server.registerTool("obter_versao_core"',start)
health_tool=mcp[start:end]
checks={
 'app_package_0_20_54':package.get('version')=='0.20.54',
 'core_package_0_20_54':cfpackage.get('version')=='0.20.54',
 'app_version_constant': 'const APP_VERSION = "0.20.54";' in page and 'const EXPECTED_CORE_VERSION = APP_VERSION;' in page,
 'next_health_surface_0_20_54':'version: "0.20.54"' in health_route,
 'worker_health_version_0_20_54':'core_version: "0.20.54"' in index and 'version: "0.20.54"' in index,
 'mcp_server_0_20_54':'version: "0.20.54"' in mcp,
 'bundle_intentionally_unbuilt':'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.54)' in bundle,
 'schema_stays_2_27':'schemaVersion:"2.27.0"' in migrations_route and 'const CONTRACT_VERSION = "2.27.0"' in contract,
 'd1_free_version_route':'url.pathname === "/version"' in index and 'd1_read_required:false' in index and 'schema_contract_version:"2.27.0"' in index,
 'version_route_before_health':index.index('url.pathname === "/version"') < index.index('url.pathname === "/health"'),
 'ui_always_has_version_panel':'coreVersionPanel' in page and '<span>APP</span>' in page and '<span>CORE / WORKER</span>' in page and '<span>STATUS</span>' in page,
 'ui_manual_update_button':'Atualizar Core agora' in page and 'onClick={()=>void updateCoreFromApp()}' in page,
 'ui_version_check_not_gated_by_core_ok':'health?.core.ok && health.core.version && health.core.version !== EXPECTED_CORE_VERSION' not in page,
 'ui_d1_independent_copy':'A checagem de versão é independente do D1' in page,
 'ui_refreshes_d1_free_version':'fetch("/api/version"' in page and 'refreshCoreVersion' in page,
 'ui_falls_back_to_health':'response = await fetch("/api/health"' in page,
 'ui_update_partial_success_when_d1_blocked':'Core atualizado para ${EXPECTED_CORE_VERSION}. A verificação/migration do D1 ficou pendente' in page,
 'ui_auto_update_preserved':'setReleaseGateMessage("Atualizando o Core seguro…")' in page and 'fetch("/api/control/update-core"' in page,
 'version_panel_responsive':'.coreVersionGrid' in css and '@media(max-width:760px){.coreVersionGrid{grid-template-columns:1fr}' in css,
 'mcp_health_exposes_core_version':'core_version:"0.20.54"' in health_tool,
 'mcp_health_no_catalog_scan':'catalogStats(env)' not in health_tool,
 'mcp_health_minimal_d1_probe':'SELECT 1 AS ok' in health_tool,
 'mcp_zero_read_version_tool':'registerTool("obter_versao_core"' in mcp and 'd1_read_required:false' in mcp,
 # preserve critical previous architecture
 'd1_actionable_control_plane_preserved':'registerTool("listar_projetos_acionaveis"' in mcp,
 'worker_compaction_preserved':'registerTool("compactar_fila_workers"' in mcp and 'compactWorkerQueue' in workers,
 'd1_telemetry_preserved':'v2_mcp_route_telemetry' in telemetry,
 'inline_qa_preserved':'browser_required: false' in mcp and 'permission_required: false' in mcp,
 'responsive_workspace_preserved':'container-name:project-detail' in css,
 'optional_publication_preserved':'publication_optional:true' in model,
 'thumb_local_upload_preserved':'registerTool("anexar_thumb_arquivo"' in mcp,
 'short_snapshot_preserved':'export async function getShortOperationalSnapshot' in projects and 'not_modified:true' in projects,
}
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.54','schema':'2.27.0','feature':'APP/Core version synchronization + D1-free version probe + manual Core update fallback','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_54_APP_CORE_VERSION_SYNC.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
