from pathlib import Path
import json, sys
R=Path(__file__).resolve().parents[1]
read=lambda p:(R/p).read_text(encoding='utf-8')
be=read('cloudflare/src/quiz/browser-executor.ts')
svc=read('cloudflare/src/quiz/service.ts')
layout=read('app/layout.tsx')
local_client=read('app/local-quiz-renderer-client.tsx')
pkg=json.loads(read('package.json'))
lock=json.loads(read('package-lock.json'))
cfpkg=json.loads(read('cloudflare/package.json'))
bundle=read('lib/generated-core-bundle.ts')
checks={
 'local_renderer_component_present':'LocalQuizRendererClient' in layout and 'local-quiz-renderer-client' in layout,
 'local_renderer_hidden_iframe':'/quiz-studio/index.html?local_renderer=1' in local_client and 'pointerEvents' in local_client,
 'local_renderer_claim_loop':"rpc('claim'" in local_client and "rpc('heartbeat'" in local_client and "rpc('complete'" in local_client,
 'local_renderer_bridge_uploads_media':"if (op === 'media.upload') return request('media', payload?.blob, true);" in local_client,
 'renderer_status_local_first':"mode:'LOCAL_BROWSER'" in svc and "preference:'LOCAL_FIRST'" in svc and 'fallback_mode' in svc,
 'local_executor_prefix_tracking':"LOCAL_EXECUTOR_PREFIX='local:'" in svc and 'hasActiveLocalExecutors' in svc,
 'browser_waits_for_local_priority':'LOCAL_PRIORITY_GRACE_MS=12_000' in be and 'waitForLocalPriority' in be and "LOCAL_BROWSER_PRIORITY" in be,
 'release_version_root':pkg.get('version')=='0.20.63',
 'release_version_lock':lock.get('version')=='0.20.63' and lock.get('packages',{}).get('',{}).get('version')=='0.20.63',
 'release_version_core':cfpkg.get('version')=='0.20.63',
 'bundle_fail_safe':'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'CORE_WORKER_BUNDLE: string = ""' in bundle and '0.20.63' in bundle,
}
failed=[k for k,v in checks.items() if not v]
print(json.dumps({'passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks},indent=2,ensure_ascii=False))
sys.exit(1 if failed else 0)
