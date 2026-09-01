from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
mcp=(root/'cloudflare/src/mcp.ts').read_text()
model=(root/'cloudflare/src/core/production-model.ts').read_text()
index=(root/'cloudflare/src/index.ts').read_text()
page=(root/'app/page.tsx').read_text()
package=json.loads((root/'package.json').read_text())
cfpackage=json.loads((root/'cloudflare/package.json').read_text())
bundle=(root/'lib/generated-core-bundle.ts').read_text()
checks={
  'version_app_0_20_51': package.get('version')=='0.20.51',
  'version_core_package_0_20_51': cfpackage.get('version')=='0.20.51',
  'version_page_0_20_51': 'const EXPECTED_CORE_VERSION = "0.20.51"' in page,
  'version_worker_0_20_51': 'version: "0.20.51"' in index,
  'version_mcp_0_20_51': 'version: "0.20.51"' in mcp,
  'bundle_unbuilt_0_20_51': 'CORE_WORKER_BUNDLE_VERSION: string = "UNBUILT"' in bundle and 'package.json (0.20.51)' in bundle,
  'qa_tool_is_inline_visual_route': 'CAMINHO VISUAL OBRIGATÓRIO DO QA POR REJEIÇÃO' in mcp,
  'qa_tool_returns_image_content': 'type: "image", data: bytesToBase64(bytes), mimeType' in mcp,
  'qa_reads_pixels_directly_from_r2': 'const object = await env.MEDIA.get(r2Key)' in mcp,
  'qa_does_not_require_browser': 'browser_required: false' in mcp,
  'qa_does_not_require_permission': 'permission_required: false' in mcp,
  'qa_explicitly_forbids_permission_prompt': 'NÃO peça permissão ao usuário' in mcp,
  'preview_url_removed_from_primary_payload': 'preview_url: null' in mcp,
  'signed_url_retained_only_for_diagnostics': 'diagnostic_preview_url: diagnosticPreviewUrl' in mcp and 'DIAGNOSTIC_ONLY_DO_NOT_OPEN_FOR_QA' in mcp,
  'delivery_mode_exposes_inline_qa': 'INLINE_QA_IMAGES_WITH_LINK_DOWNLOADS' in mcp,
  'delivery_policy_no_browser': 'qa_browser_required:false' in mcp,
  'delivery_policy_no_permission': 'qa_permission_required:false' in mcp,
  'qa_default_page_is_bounded': 'INLINE_QA_DEFAULT_LIMIT = 6' in mcp,
  'qa_page_max_is_bounded': 'INLINE_QA_MAX_LIMIT = 12' in mcp and 'max(12)' in mcp,
  'qa_has_offset_pagination': 'offset:z.number().int().min(0).optional()' in mcp and 'next_offset' in mcp,
  'core_query_has_sql_offset': 'LIMIT ? OFFSET ?' in model and 'safeOffset' in model,
  'qa_inline_has_per_image_limit': 'INLINE_QA_MAX_IMAGE_BYTES' in mcp,
  'qa_inline_has_total_payload_limit': 'INLINE_QA_MAX_TOTAL_BYTES' in mcp,
  'base64_is_chunked_not_spread_whole_file': 'const chunk = 0x8000' in mcp,
  'supported_inline_mimes_are_explicit': '"image/jpeg", "image/png", "image/webp", "image/gif"' in mcp,
  'missing_r2_object_does_not_trigger_browser': 'QA_INLINE_PREVIEW_UNAVAILABLE' in mcp and 'R2_OBJECT_NOT_FOUND' in mcp,
  'payload_limit_does_not_request_permission': 'CALL_NEXT_QA_PAGE_NO_BROWSER' in mcp,
  'signed_preview_head_fix_preserved': 'request.method === "GET" || request.method === "HEAD"' in index,
  'qa_by_rejection_preserved': 'rejeitar_production_slots_lote' in mcp and 'finalizar_qa_projeto' in mcp,
  'thumb_local_upload_preserved': 'anexar_thumb_arquivo' in mcp,
  'schema_unchanged_2_26': 'schemaVersion:"2.26.0"' in (root/'app/api/setup/migrations/route.ts').read_text(),
}
failed=[k for k,v in checks.items() if not v]
report={'version':'0.20.51','feature':'Inline MCP QA previews without browser or permission prompts','passed':len(checks)-len(failed),'total':len(checks),'ok':not failed,'failed':failed,'checks':checks}
(root/'BEHAVIOR_GATE_0_20_51_INLINE_MCP_QA_PREVIEWS.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
