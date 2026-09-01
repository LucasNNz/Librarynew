from pathlib import Path
import subprocess, tempfile, json, sys
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as d:
    subprocess.run(['tsc',str(root/'cloudflare/src/core/public-media.ts'),'--target','ES2022','--module','ESNext','--lib','ES2022,DOM,DOM.Iterable','--skipLibCheck','--outDir',d,'--pretty','false'],check=True)
    smoke=Path(d)/'smoke.mjs'
    smoke.write_text('''import { publicMediaResponse } from './public-media.js';\nconst producer=async()=>new Response(new Uint8Array([1,2,3,4]),{status:200,headers:{"content-type":"image/png",etag:"demo"}});\nconst head=await publicMediaResponse(new Request("https://core.example/candidate-files/CAND-X",{method:"HEAD"}),"candidate-file","0.20.51",producer);\nconst get=await publicMediaResponse(new Request("https://core.example/candidate-files/CAND-X",{method:"GET"}),"candidate-file","0.20.51",producer);\nconst report={head_status:head.status,head_body_bytes:(await head.arrayBuffer()).byteLength,head_route:head.headers.get("x-corvo-public-media-route"),head_version:head.headers.get("x-corvo-core-version"),head_type:head.headers.get("content-type"),get_status:get.status,get_body_bytes:(await get.arrayBuffer()).byteLength,get_route:get.headers.get("x-corvo-public-media-route")};\nconst ok=report.head_status===200&&report.head_body_bytes===0&&report.head_route==="candidate-file"&&report.head_version==="0.20.51"&&report.head_type==="image/png"&&report.get_status===200&&report.get_body_bytes===4; console.log(JSON.stringify({...report,ok})); if(!ok)process.exit(1);''')
    out=subprocess.check_output(['node',str(smoke)],text=True)
    report=json.loads(out)
(root/'SMOKE_0_20_51_PUBLIC_MEDIA.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
sys.exit(0 if report.get('ok') else 1)
