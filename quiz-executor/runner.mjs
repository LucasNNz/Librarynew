import { chromium } from 'playwright';
import { muxAudio } from './audio-mux.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';

const core=process.env.CORVO_CORE_URL?.replace(/\/$/,''),key=process.env.CORVO_APP_KEY;
if(!core||!key)throw Error('Set CORVO_CORE_URL and CORVO_APP_KEY to the existing Library connection.');
const base=new URL(core);if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw Error('HTTPS required');
const owner=randomUUID(),root=fileURLToPath(new URL('../public/quiz-studio/',import.meta.url));
async function rpc(op,payload={}){const r=await fetch(core+'/quiz/rpc',{method:'POST',headers:{'content-type':'application/json','x-corvo-app-key':key},body:JSON.stringify({op,payload}),signal:AbortSignal.timeout(30000)});const v=await r.json();if(!r.ok||v.ok===false)throw Error(v.error||`HTTP_${r.status}`);return v;}
const types={'.html':'text/html','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg','.webp':'image/webp'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root))throw Error();const body=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined,args:['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const localOrigin=`http://127.0.0.1:${server.address().port}`;
const privateIp=(ip)=>ip==='::1'||ip==='::'||/^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^fc|^fd|^fe[89ab]|^::ffff:/i.test(ip);
await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===localOrigin||u.origin===base.origin||['data:','blob:'].includes(u.protocol))return route.continue();
  try{if(u.protocol!=='https:'||u.username||u.password)throw Error();const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>privateIp(x.address)))throw Error();return route.continue();}catch{return route.abort('accessdenied');}
});
let stopping=false,current=null,leaseLost=false,muxAbort=null;
await page.exposeFunction('__quizMux',async p=>{muxAbort=new AbortController();try{return await muxAudio({...p,core,key,rpc,signal:muxAbort.signal});}finally{muxAbort=null;}});
await page.exposeFunction('__quizRpc',async(op,p)=>{
  if(!['asset.resolve','upload-start','upload-finish','upload-abort'].includes(op))throw Error('HOST_OPERATION_NOT_ALLOWED');return rpc(op,p);
});
await page.exposeFunction('__quizPart',async(id,n,data)=>{
  const r=await fetch(`${core}/quiz/upload/${encodeURIComponent(id)}/${n}`,{method:'PUT',headers:{'x-corvo-app-key':key,'content-type':'application/octet-stream'},body:Buffer.from(data,'base64'),signal:AbortSignal.timeout(120000)});const v=await r.json();if(!r.ok)throw Error(v.error||'UPLOAD_FAILED');return {partNumber:v.partNumber,etag:v.etag};
});
await page.addInitScript(()=>{
  async function upload(blob){
    const start=await window.__quizRpc('upload-start',{mime:blob.type||'application/octet-stream',size:blob.size}),parts=[];
    try{for(let i=0;i<blob.size;i+=8*1024*1024){const bytes=new Uint8Array(await blob.slice(i,i+8*1024*1024).arrayBuffer());let raw='';for(let j=0;j<bytes.length;j+=8192)raw+=String.fromCharCode(...bytes.subarray(j,j+8192));parts.push(await window.__quizPart(start.id,parts.length+1,btoa(raw)));}return await window.__quizRpc('upload-finish',{id:start.id,parts});}
    catch(e){await window.__quizRpc('upload-abort',{id:start.id}).catch(()=>{});throw e;}
  }
  window.__quizUpload=upload;
  window.CorvoLibrary={serverAudio:true,getConnection:()=>({connection_label:'Librarynew executor',push:true}),registerQuizStudio:()=>{},quizRequest:async(op,p)=>{
    if(op==='asset.resolve')return window.__quizRpc(op,p);
    if(op==='media.upload')return upload(p.blob);
    if(op==='video.mux')return window.__quizMux(p);
    if(['quiz.state.push','quiz.visual.publish'].includes(op))return {ok:true};
    throw Error('UNSUPPORTED_HOST_OPERATION');
  }};
});
page.on('pageerror',e=>console.error('Editor error:',e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'load'});
await page.waitForFunction(()=>!!window.CorvoQuizStudio?.snapshot);
const heartbeat=setInterval(async()=>{
  if(!current)return;
  try{const h=await rpc('heartbeat',{owner,job_id:current.id});if(h.cancel){leaseLost=true;muxAbort?.abort();await page.evaluate(()=>window.CorvoQuizStudio.cancel());}}
  catch{leaseLost=true;muxAbort?.abort();await page.evaluate(()=>window.CorvoQuizStudio.cancel()).catch(()=>{});}
},10000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;muxAbort?.abort();page.evaluate(()=>window.CorvoQuizStudio.cancel()).catch(()=>{});});
console.log('Quiz executor ready.');
while(!stopping){
  try{
    const claimed=await rpc('claim',{owner});if(!claimed.job){await new Promise(r=>setTimeout(r,1000));continue;}
    current=claimed.job;leaseLost=false;
    if(current.expected_revision!==null&&current.expected_revision!==current.revision){await rpc('complete',{owner,job_id:current.id,revision:current.revision,result:{ok:false,error:'REVISION_CONFLICT'}});current=null;continue;}
    const outcome=await page.evaluate(async(job)=>{
      const api=window.CorvoQuizStudio;api.loadSnapshot(job.project);
      const result=await api.handle(job.command);
      if(!result.ok)return {result};
      const {externalize}=await import('/host-client.js');
      const project=await externalize(api.snapshot(),window.__quizUpload);
      return {result,project,summary:api.getSummary()};
    },current);
    if(leaseLost)outcome.result={ok:false,error:'CANCELLED_OR_LEASE_LOST'};
    const done=await rpc('complete',{owner,job_id:current.id,revision:current.revision,...outcome});
    console.log(`Job ${current.id}: ${done.status}`);current=null;
  }catch(e){console.error('Executor:',e.message);if(current){await rpc('complete',{owner,job_id:current.id,revision:current.revision,result:{ok:false,error:e.message}}).catch(()=>{});current=null;}await new Promise(r=>setTimeout(r,2000));}
}
clearInterval(heartbeat);await browser.close();server.close();
