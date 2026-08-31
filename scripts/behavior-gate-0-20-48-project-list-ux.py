from pathlib import Path
import json, re, sys
root=Path(__file__).resolve().parents[1]
page=(root/'app/page.tsx').read_text()
css=(root/'app/globals.css').read_text()
package=json.loads((root/'package.json').read_text())
cfpackage=json.loads((root/'cloudflare/package.json').read_text())
index=(root/'cloudflare/src/index.ts').read_text()
mcp=(root/'cloudflare/src/mcp.ts').read_text()
bundle=(root/'lib/generated-core-bundle.ts').read_text()
checks={
  'version_app_0_20_48': package.get('version')=='0.20.48',
  'version_core_package_0_20_48': cfpackage.get('version')=='0.20.48',
  'version_page_0_20_48': 'const EXPECTED_CORE_VERSION = "0.20.48"' in page,
  'version_worker_0_20_48': 'version: "0.20.48"' in index,
  'version_mcp_0_20_48': 'version: "0.20.48"' in mcp,
  'bundle_unbuilt_0_20_48': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.48)' in bundle,
  'project_default_active': 'useState<ProjectFilter>("ACTIVE")' in page,
  'tabs_have_active': '["ACTIVE","Em andamento"]' in page,
  'tabs_have_pending_24h': '["24H","Pendentes 24h"]' in page,
  'tabs_have_completed': '["COMPLETED","Concluídos"]' in page,
  'tabs_have_rejected': '["REJECTED","Rejeitados"]' in page,
  'tabs_do_not_mix_all': '["ALL","Todos"]' not in page,
  'recent_filter_active_only': 'lifecycle==="ACTIVE"&&Number(project.updated_at||project.created_at||0)>=since' in page,
  'legacy_all_is_active_only': 'projectFilter==="ALL"' in page and '? lifecycle==="ACTIVE"' in page,
  'selection_clears_on_tab_switch': 'setProjectFilter(key);setSelectedProjectIds(new Set());' in page,
  'completed_context_is_explicit': 'Projetos concluídos' in page and 'fora da fila operacional' in page,
  'active_context_is_explicit': 'Fila operacional · concluídos ficam em uma área separada' in page,
  'completed_hides_complete_reject_actions': 'projectFilter!=="COMPLETED"&&projectFilter!=="REJECTED"' in page,
  'global_webkit_scrollbar': '*::-webkit-scrollbar{width:8px;height:8px}' in css,
  'global_firefox_scrollbar': '*{scrollbar-width:thin;scrollbar-color:#514168 transparent}' in css,
  'scrollbar_buttons_removed': '*::-webkit-scrollbar-button{width:0;height:0;display:none}' in css,
  'scrollbar_corner_transparent': '*::-webkit-scrollbar-corner{background:transparent}' in css,
  'horizontal_page_overflow_blocked': 'html,body{overflow-x:hidden' in css and '.workspace,.content{min-width:0;max-width:100%;overflow-x:clip}' in css,
  'vertical_lists_stable_gutter': 'scrollbar-gutter:stable;overscroll-behavior:contain' in css,
  'horizontal_nav_scrollbar_hidden': '.moduleTabs::-webkit-scrollbar,.primaryNav::-webkit-scrollbar,.projectRailTabs::-webkit-scrollbar{display:none;width:0;height:0}' in css,
  'project_list_vertical_only': '.projectCardList{flex:1 1 auto;min-height:0;overflow-y:auto!important;overflow-x:hidden!important' in css,
  'bulk_actions_grid': '.projectBulkRail.always{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))' in css,
  'bulk_buttons_no_overflow': '.projectBulkRail.always button{width:100%;min-width:0;max-width:100%' in css,
  'project_cards_clipped': '.projectListCard{max-width:100%;overflow:hidden}' in css,
  'schema_unchanged_2_26': 'schemaVersion:"2.26.0"' in (root/'app/api/setup/migrations/route.ts').read_text(),
  'thumb_hotfix_preserved': "VALUES (?,?,'THUMB','THUMB_CANDIDATE',?,?,?,?,?,?,0,?,?,?,?,?)" in (root/'cloudflare/src/core/production.ts').read_text(),
}
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.48','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_48_PROJECT_LIST_UX_SCROLLBARS.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
