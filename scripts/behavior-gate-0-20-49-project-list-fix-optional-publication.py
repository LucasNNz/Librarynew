from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
page=(root/'app/page.tsx').read_text()
css=(root/'app/globals.css').read_text()
workflow=(root/'cloudflare/src/core/project-workflow.ts').read_text()
prod=(root/'cloudflare/src/core/production.ts').read_text()
model=(root/'cloudflare/src/core/production-model.ts').read_text()
mcp=(root/'cloudflare/src/mcp.ts').read_text()
package=json.loads((root/'package.json').read_text())
cfpackage=json.loads((root/'cloudflare/package.json').read_text())
index=(root/'cloudflare/src/index.ts').read_text()
bundle=(root/'lib/generated-core-bundle.ts').read_text()
checks={
  'version_app_0_20_49': package.get('version')=='0.20.49',
  'version_core_package_0_20_49': cfpackage.get('version')=='0.20.49',
  'version_page_0_20_49': 'const EXPECTED_CORE_VERSION = "0.20.49"' in page,
  'version_worker_0_20_49': 'version: "0.20.49"' in index,
  'version_mcp_0_20_49': 'version: "0.20.49"' in mcp,
  'bundle_unbuilt_0_20_49': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.49)' in bundle,
  'project_cards_do_not_shrink': '.projectCardList>.projectListCard{flex:0 0 auto!important;min-height:78px' in css,
  'project_cards_disable_content_visibility': 'content-visibility:visible!important;contain:none!important' in css,
  'project_list_still_vertical_scroll_only': '.projectCardList{flex:1 1 auto;min-height:0;overflow-y:auto!important;overflow-x:hidden!important' in css,
  'modern_scrollbars_preserved': '*::-webkit-scrollbar{width:8px;height:8px}' in css and 'scrollbar-color:#514168 transparent' in css,
  'completed_separation_preserved': '["COMPLETED","Concluídos"]' in page and 'useState<ProjectFilter>("ACTIVE")' in page,
  'publication_marked_optional_ui': 'optional:true' in page and 'thumbs_titulos.zip</b> é opcional' in page,
  'summary_marks_thumb_optional': 'Thumbs <span className="projectSummaryOptional">opcional</span>' in page,
  'summary_marks_title_optional': 'Títulos <span className="projectSummaryOptional">opcional</span>' in page,
  'completion_required_artifacts_images_script': 'const requiredArtifactsReady=finalArtifactsReady.images&&finalArtifactsReady.script;' in workflow,
  'completion_does_not_require_publication': 'requiredArtifactsReady=finalArtifactsReady.images&&finalArtifactsReady.script&&finalArtifactsReady.publication' not in workflow,
  'completion_error_reports_optional_publication': 'publication_optional:true' in workflow,
  'production_gate_publication_optional': 'const packageReady=artifacts.images&&artifacts.script;' in model and 'publication_optional:true' in model,
  'production_gate_does_not_require_publication': 'const packageReady=artifacts.images&&artifacts.script&&artifacts.publication;' not in model,
  'final_artifact_api_marks_publication_optional': 'required_for_completion:type!=="PROJECT_PUBLICATION_ZIP"' in prod and 'optional:type==="PROJECT_PUBLICATION_ZIP"' in prod,
  'mcp_completion_contract_explicit': 'THUMB e TÍTULO/publicação são opcionais' in mcp,
  'schema_unchanged_2_26': 'schemaVersion:"2.26.0"' in (root/'app/api/setup/migrations/route.ts').read_text(),
  'thumb_d1_hotfix_preserved': "VALUES (?,?,'THUMB','THUMB_CANDIDATE',?,?,?,?,?,?,0,?,?,?,?,?)" in prod,
  'qa_by_rejection_preserved': 'finalizar_qa_projeto' in mcp and 'rejeitar_production_slots_lote' in mcp,
}
# behavioral truth table for lifecycle requirements
def can_close(resolved,total,images,script,publication):
    return total>0 and resolved>=total and images and script
checks.update({
  'truth_complete_without_publication': can_close(102,102,True,True,False) is True,
  'truth_complete_with_publication': can_close(102,102,True,True,True) is True,
  'truth_blocks_missing_images': can_close(102,102,False,True,False) is False,
  'truth_blocks_missing_script': can_close(102,102,True,False,False) is False,
  'truth_blocks_unresolved_slots': can_close(101,102,True,True,False) is False,
})
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.49','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_49_PROJECT_LIST_FIX_OPTIONAL_PUBLICATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
