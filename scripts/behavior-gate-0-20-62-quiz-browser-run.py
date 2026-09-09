from pathlib import Path
import json, re, sys
R=Path(__file__).resolve().parents[1]
read=lambda p:(R/p).read_text(encoding='utf-8')
be=read('cloudflare/src/quiz/browser-executor.ts')
svc=read('cloudflare/src/quiz/service.ts')
idx=read('cloudflare/src/index.ts')
ctrl=read('lib/cloudflare-control.ts')
wr=read('cloudflare/wrangler.jsonc.example')
pkg=json.loads(read('package.json'))
lock=json.loads(read('package-lock.json'))
cfpkg=json.loads(read('cloudflare/package.json'))
bundle=read('lib/generated-core-bundle.ts')
checks={
 'no_legacy_cloudflare_browser_host': 'cloudflare.browser' not in be and 'cloudflare.browser' not in svc,
 'limits_internal_binding_endpoint': "https://fake.host/v1/limits" in svc,
 'acquire_internal_binding_endpoint': '/v1/devtools/browser?keep_alive=' in be and "BROWSER_HOST='https://fake.host'" in be,
 'max_keepalive_10m': 'BROWSER_KEEP_ALIVE_MS=600_000' in be,
 'browser_websocket_current_endpoint': '/v1/devtools/browser/${encodeURIComponent(browserSessionId)}' in be,
 'standard_cdp_target_create': "Target.createTarget" in be,
 'standard_cdp_flatten_attach': "Target.attachToTarget" in be and 'flatten:true' in be,
 'page_session_routing': "pageSessionId" in be and "Runtime.evaluate" in be,
 'browser_keepalive_command': "Browser.getVersion" in be,
 'd1_job_heartbeat': "'heartbeat',{owner,job_id:job.id}" in be,
 'heartbeat_interval': '25_000' in be and 'setInterval' in be,
 'target_close_finally': "Target.closeTarget" in be,
 'browser_close_finally': "Browser.close" in be and 'finally{' in be,
 'renderer_online_browser_run': "mode:'CLOUDFLARE_BROWSER_RENDERING'" in svc and "browser_closed_ok:true" in svc,
 'renderer_diagnostics': "provider:'BROWSER_RUN'" in svc and "binding:'BROWSER'" in svc and 'limits' in svc,
 'queue_quiz_job': "job.kind === \"QUIZ_JOB\"" in idx and 'processQuizBrowserJob' in idx,
 'wrangler_browser_binding': '"binding": "BROWSER"' in wr,
 'control_deploy_browser_binding': 'type: "browser"' in ctrl and 'name: "BROWSER"' in ctrl,
 'release_version_root': pkg.get('version')=='0.20.62',
 'release_version_lock': lock.get('version')=='0.20.62' and lock.get('packages',{}).get('',{}).get('version')=='0.20.62',
 'release_version_core': cfpkg.get('version')=='0.20.62',
 'schema_unchanged': 'schema_contract_version:"2.29.0"' in idx,
 'bundle_fail_safe': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'CORE_WORKER_BUNDLE: string = ""' in bundle,
 'previous_30_gate_preserved': json.loads(read('VALIDATION_0_20_61_ROTEIRO_LIBRARY_CYCLE_QUIZ_HANDOFF.json'))['requirements_gate']['passed']==30,
}
failed=[k for k,v in checks.items() if not v]
print(json.dumps({'passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks},indent=2,ensure_ascii=False))
sys.exit(1 if failed else 0)
