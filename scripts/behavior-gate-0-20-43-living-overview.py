from pathlib import Path
import json, subprocess, sys, re
root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf-8')
page=read('app/page.tsx')
css=read('app/globals.css')
profile=read('cloudflare/src/core/project-profile.ts')
ingest=read('cloudflare/src/core/ingest.ts')
direct=read('cloudflare/src/core/direct-upload.ts')
mcp=read('cloudflare/src/mcp.ts')
index=read('cloudflare/src/index.ts')
projects=read('cloudflare/src/core/projects.ts')
bundle_builder=read('scripts/build-core-bundle.mjs')
checks={
  'version_at_least_0_20_43':bool(re.search(r'const EXPECTED_CORE_VERSION = \"0\.20\.(?:4[3-9]|[5-9]\d+)\"', page)) and bool(re.search(r'version: \"0\.20\.(?:4[3-9]|[5-9]\d+)\"', index)),
  'schema_remains_2_25_no_new_migration':not (root/'cloudflare/migrations/9026_v2_project_profile.sql').exists(),
  'profile_reuses_project_media':"PROJECT_PROFILE" in profile and "v2_project_media" in profile,
  'profile_preserves_old_media':"PROFILE_REPLACED" in profile and "selected=0" in profile,
  'profile_from_asset_no_copy':"setProjectProfileFromAsset" in profile and "FROM assets" in profile and "env.MEDIA.put" not in profile,
  'profile_from_candidate':"setProjectProfileFromCandidate" in profile,
  'external_profile_fast_push':'PROJECT_PROFILE_PUSH' in index and 'project-profile' in index,
  'ingest_materialization_auto_profile':'normalizedJobTags.includes("project-profile")' in ingest,
  'direct_upload_auto_profile':'directTags.includes("project-profile")' in direct,
  'direct_upload_auto_thumb':'directTags.includes("thumb")' in direct and 'createProjectMediaFromCandidate' in direct,
  'mcp_easy_thumb':'registerTool("anexar_thumb_projeto"' in mcp and 'requireOpen:false' in mcp,
  'mcp_profile_set':'registerTool("definir_foto_perfil_projeto"' in mcp,
  'mcp_profile_get':'registerTool("obter_foto_perfil_projeto"' in mcp,
  'mcp_profile_clear':'registerTool("remover_foto_perfil_projeto"' in mcp,
  'profile_rest_api':'/profile-image$' in index,
  'overview_profile_controls':'projectCoverActions' in page and 'chooseProjectProfileFile' in page and 'setProjectProfileSource' in page,
  'completion_number_glow':'projectCompletionNumber' in page and '.projectCompletionNumber' in css and 'text-shadow' in css,
  'success_kpi_glow':'successKpi' in page and '.successKpi>div>strong' in css,
  'truthful_agent_stage_state':'projectAgentLaneState' in page and 'projectWireNodes i.waiting' in css and 'projectWireNodes i.working' in css,
  'wire_loop_animation':'wireFlow' in page and '@keyframes wireCurrent' in css and 'animation:wireCurrent' in css,
  'smooth_microinteractions':'networkSweep' in css and 'projectStagePulse' in css and 'progressTip' in css,
  'projects_list_exposes_profile_id':'profile_media_id' in projects,
  'bundle_version_from_package':'bundleVersion = String(packageJson.version' in bundle_builder and 'CORE_WORKER_BUNDLE_VERSION: string = \\"${bundleVersion}\\"' in bundle_builder,
}
report={'version':'0.20.43','schema':'2.25.0','feature':'Living overview + project profile media + reliable thumb upload','checks':checks,'pass':all(checks.values())}
out=root/'BEHAVIOR_GATE_0_20_43_LIVING_OVERVIEW_PROJECT_MEDIA.json'
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(0 if report['pass'] else 1)
