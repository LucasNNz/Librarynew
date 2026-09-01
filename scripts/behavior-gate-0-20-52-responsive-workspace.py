from pathlib import Path
import json, re, sys
import tinycss2

root=Path(__file__).resolve().parents[1]
css=(root/'app/globals.css').read_text()
page=(root/'app/page.tsx').read_text()
package=json.loads((root/'package.json').read_text())
cfpackage=json.loads((root/'cloudflare/package.json').read_text())
index=(root/'cloudflare/src/index.ts').read_text()
mcp=(root/'cloudflare/src/mcp.ts').read_text()
bundle=(root/'lib/generated-core-bundle.ts').read_text()

checks={
 'version_app_0_20_52': package.get('version')=='0.20.52',
 'version_core_package_0_20_52': cfpackage.get('version')=='0.20.52',
 'version_page_0_20_52': 'const EXPECTED_CORE_VERSION = "0.20.52"' in page,
 'version_worker_0_20_52': 'version: "0.20.52"' in index,
 'version_mcp_0_20_52': 'version: "0.20.52"' in mcp,
 'bundle_unbuilt_0_20_52': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.52)' in bundle,
 'release_css_marker': '0.20.52 — responsive workspace' in css,
 'detail_is_container': 'container-type:inline-size' in css and 'container-name:project-detail' in css,
 'body_uses_clamped_rail': 'grid-template-columns:minmax(270px,clamp(285px,23vw,360px)) minmax(0,1fr)' in css,
 'pipeline_auto_fit': 'grid-template-columns:repeat(auto-fit,minmax(145px,1fr))' in css,
 'slot_grid_auto_fit': 'grid-template-columns:repeat(auto-fit,minmax(210px,1fr))' in css,
 'final_files_auto_fit': 'grid-template-columns:repeat(auto-fit,minmax(245px,1fr))' in css,
 'detail_lower_flexible': 'grid-template-columns:minmax(0,1.45fr) minmax(220px,.72fr)' in css,
 'header_can_reflow': '@container project-detail (max-width:680px)' in css and '.projectDetailHeader{grid-template-columns:1fr;align-items:start}' in css,
 'narrow_canvas_single_columns': '@container project-detail (max-width:430px)' in css and '.projectPipelineTrack,.projectSlotCards,.projectFinalFileGrid{grid-template-columns:1fr}' in css,
 'viewport_fallback_stacks_workspace': '@media(max-width:1180px)' in css and '.projectStudioBody{grid-template-columns:1fr}' in css,
 'responsive_project_list_after_stack': 'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))' in css,
 'slot_actions_wrap': '.projectSlotActions{min-width:0;max-width:100%;flex-wrap:wrap}' in css,
 'slot_actions_no_forced_nowrap': '.projectSlotActions button,\n.projectSlotActions a{max-width:100%;white-space:normal' in css,
 'long_project_metadata_wraps': '.projectDetailIdentity p{max-width:100%;overflow-wrap:anywhere;word-break:break-word}' in css,
 'project_id_can_wrap': '.projectDetailIdentity code{white-space:normal;overflow-wrap:anywhere}' in css,
 'artifact_rows_can_shrink': '.projectArtifactIdentity,\n.projectArtifactState,\n.projectArtifactActions{min-width:0;max-width:100%}' in css,
 'pipeline_connectors_disabled_when_wrapping': '.pipelineConnector{display:none}' in css,
 'mobile_project_grid_auto_fit': '.projectKpiGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}' in css,
 'legacy_project_filters_preserved': all(x in page for x in ['["ACTIVE","Em andamento"]','["COMPLETED","Concluídos"]','["REJECTED","Rejeitados"]']),
 'optional_publication_preserved': 'optional:true' in page and 'thumbs_titulos.zip' in page,
 'qa_inline_preserved': 'browser_required: false' in mcp and 'permission_required: false' in mcp,
 'no_new_schema_bump': 'schemaVersion:"2.26.0"' in (root/'app/api/setup/migrations/route.ts').read_text(),
}
# CSS parse must not produce syntax errors.
rules=tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True)
errors=[r for r in rules if getattr(r,'type',None)=='error']
checks['css_parses_without_top_level_errors']=not errors

failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.52','feature':'Responsive project workspace based on actual detail-canvas width','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_52_RESPONSIVE_WORKSPACE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
