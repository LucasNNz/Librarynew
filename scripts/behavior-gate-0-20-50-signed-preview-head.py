from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
index=(root/'cloudflare/src/index.ts').read_text()
public_media=(root/'cloudflare/src/core/public-media.ts').read_text()
auth=(root/'cloudflare/src/core/auth.ts').read_text()
storage=(root/'cloudflare/src/core/storage.ts').read_text()
thumbs=(root/'cloudflare/src/core/thumbnails.ts').read_text()
material=(root/'cloudflare/src/core/materialization.ts').read_text()
http=(root/'cloudflare/src/core/http.ts').read_text()
page=(root/'app/page.tsx').read_text()
css=(root/'app/globals.css').read_text()
workflow=(root/'cloudflare/src/core/project-workflow.ts').read_text()
prod=(root/'cloudflare/src/core/production.ts').read_text()
model=(root/'cloudflare/src/core/production-model.ts').read_text()
mcp=(root/'cloudflare/src/mcp.ts').read_text()
package=json.loads((root/'package.json').read_text())
cfpackage=json.loads((root/'cloudflare/package.json').read_text())
bundle=(root/'lib/generated-core-bundle.ts').read_text()
checks={
  'version_app_0_20_50': package.get('version')=='0.20.50',
  'version_core_package_0_20_50': cfpackage.get('version')=='0.20.50',
  'version_page_0_20_50': 'const EXPECTED_CORE_VERSION = "0.20.50"' in page,
  'version_worker_0_20_50': 'version: "0.20.50"' in index,
  'version_mcp_0_20_50': 'version: "0.20.50"' in mcp,
  'bundle_unbuilt_0_20_50': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.50)' in bundle,
  'signed_media_accepts_get_and_head': 'const signedMediaMethod = request.method === "GET" || request.method === "HEAD";' in index,
  'candidate_route_uses_signed_media_method': 'url.pathname.startsWith("/candidate-files/") && signedMediaMethod' in index,
  'asset_thumb_route_uses_signed_media_method': 'url.pathname.startsWith("/thumbs/") && signedMediaMethod' in index,
  'asset_file_route_uses_signed_media_method': 'url.pathname.startsWith("/files/") && signedMediaMethod' in index,
  'project_media_route_uses_signed_media_method': 'url.pathname.startsWith("/project-media/") && signedMediaMethod' in index,
  'project_file_route_uses_signed_media_method': 'url.pathname.startsWith("/project-files/") && signedMediaMethod' in index,
  'package_route_uses_signed_media_method': 'url.pathname.startsWith("/package-files/") && signedMediaMethod' in index,
  'head_response_has_no_body': 'if (request.method === "HEAD")' in public_media and 'return new Response(null' in public_media,
  'diagnostic_route_header': 'x-corvo-public-media-route' in public_media,
  'diagnostic_version_header': 'x-corvo-core-version' in public_media and '"0.20.50"' in index,
  'candidate_head_checks_r2_without_body': 'request.method === "HEAD" ? await env.MEDIA.head(row.r2_key) : await env.MEDIA.get(row.r2_key)' in storage,
  'candidate_head_returns_null_body': 'request.method === "HEAD" ? null : (object as R2ObjectBody).body' in storage,
  'thumb_head_checks_cached_r2': 'const cachedHead = await env.MEDIA.head(thumbKey);' in thumbs,
  'thumb_head_checks_original_r2': 'const originalHead = await env.MEDIA.head(String(row.r2_key || ""));' in thumbs,
  'thumb_head_never_needs_remote_generation': thumbs.index('if (request.method === "HEAD")') < thumbs.index('const cached = await cachedThumbnail'),
  'cors_explicitly_allows_head': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS' in http,
  'signed_candidate_path_matches_router': '/candidate-files/${encodeURIComponent(candidateId)}' in auth and len('/candidate-files/')==17,
  'signed_thumb_path_matches_router': '/thumbs/${encodeURIComponent(assetId)}' in auth and len('/thumbs/')==8,
  'probe_starts_with_head': 'method: "HEAD"' in material,
  'probe_falls_back_to_get': 'method: "GET"' in material and 'range:"bytes=0-0"' in material,
  'probe_fallback_covers_404_405': '[400,403,404,405,501].includes(response.status)' in material,
  'schema_unchanged_2_26': 'schemaVersion:"2.26.0"' in (root/'app/api/setup/migrations/route.ts').read_text(),
  # Critical regressions from 0.20.47-0.20.49.
  'thumb_d1_cardinality_hotfix_preserved': "VALUES (?,?,'THUMB','THUMB_CANDIDATE',?,?,?,?,?,?,0,?,?,?,?,?)" in prod,
  'direct_thumb_file_route_preserved': 'anexar_thumb_arquivo' in mcp,
  'qa_by_rejection_preserved': 'finalizar_qa_projeto' in mcp and 'rejeitar_production_slots_lote' in mcp,
  'optional_publication_completion_preserved': 'const requiredArtifactsReady=finalArtifactsReady.images&&finalArtifactsReady.script;' in workflow,
  'production_publication_optional_preserved': 'const packageReady=artifacts.images&&artifacts.script;' in model,
  'project_cards_do_not_shrink': '.projectCardList>.projectListCard{flex:0 0 auto!important;min-height:78px' in css,
  'modern_scrollbars_preserved': '*::-webkit-scrollbar{width:8px;height:8px}' in css,
  'completed_separation_preserved': '["COMPLETED","Concluídos"]' in page and 'useState<ProjectFilter>("ACTIVE")' in page,
}
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.50','feature':'Signed preview GET+HEAD delivery','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_50_SIGNED_PREVIEW_HEAD.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
