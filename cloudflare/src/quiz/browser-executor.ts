import type { Env, QuizJob } from '../types';
import { quizRpc } from './service';

type Pending={resolve:(value:any)=>void,reject:(error:Error)=>void,timer:number};

class Cdp {
  private next=1;
  private pending=new Map<number,Pending>();
  constructor(private ws:WebSocket){
    (ws as any).accept?.();
    ws.addEventListener('message',(event:any)=>{
      try{const msg=JSON.parse(typeof event.data==='string'?event.data:new TextDecoder().decode(event.data));if(!msg.id)return;const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(new Error(msg.error.message||'CDP_ERROR')):p.resolve(msg.result);}
      catch{/* browser events do not belong to a pending request */}
    });
    ws.addEventListener('close',()=>this.rejectAll(new Error('BROWSER_SESSION_CLOSED')));
    ws.addEventListener('error',()=>this.rejectAll(new Error('BROWSER_SESSION_ERROR')));
  }
  private rejectAll(error:Error){for(const [,p] of this.pending){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  send(method:string,params:any={},timeout=30_000){
    const id=this.next++;return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP_TIMEOUT:${method}`));},timeout) as unknown as number;this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});
  }
  close(){try{this.ws.close(1000,'done');}catch{/* already closed */}}
}

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const bridgeScript=(coreOrigin:string,jobId:string,owner:string)=>`(()=>{
  const core=${JSON.stringify(coreOrigin)},headers={'content-type':'application/json','x-quiz-job':${JSON.stringify(jobId)},'x-quiz-owner':${JSON.stringify(owner)}};
  async function rpc(op,payload={}){const r=await fetch(core+'/quiz/executor/rpc',{method:'POST',headers,body:JSON.stringify({op,payload})});const v=await r.json();if(!r.ok||v.ok===false)throw Error(v.error||('HTTP_'+r.status));return v;}
  async function upload(blob){const start=await rpc('upload-start',{mime:blob.type||'application/octet-stream',size:blob.size}),parts=[];try{for(let i=0;i<blob.size;i+=8*1024*1024){const r=await fetch(core+'/quiz/executor/upload/'+encodeURIComponent(start.id)+'/'+(parts.length+1),{method:'PUT',headers:{'x-quiz-job':${JSON.stringify(jobId)},'x-quiz-owner':${JSON.stringify(owner)},'content-type':'application/octet-stream'},body:await blob.slice(i,i+8*1024*1024).arrayBuffer()});const v=await r.json();if(!r.ok)throw Error(v.error||'UPLOAD_FAILED');parts.push({partNumber:v.partNumber,etag:v.etag});}return await rpc('upload-finish',{id:start.id,parts});}catch(e){await rpc('upload-abort',{id:start.id}).catch(()=>{});throw e;}}
  window.__quizUpload=upload;
  window.CorvoLibrary={serverAudio:false,getConnection:()=>({connection_label:'Librarynew Core renderer',push:true,headless:true}),registerQuizStudio:()=>{},quizRequest:async(op,p)=>{if(op==='asset.resolve')return rpc(op,p);if(op==='media.upload')return upload(p.blob);if(['quiz.state.push','quiz.visual.publish'].includes(op))return {ok:true};throw Error('UNSUPPORTED_HOST_OPERATION:'+op);}};
})();`;

async function openPage(env:Env){
  if(!env.BROWSER)throw new Error('BROWSER_BINDING_MISSING');
  const acquired=await env.BROWSER.fetch('https://cloudflare.browser/v1/devtools/browser',{method:'POST'});if(!acquired.ok)throw new Error(`BROWSER_ACQUIRE_${acquired.status}`);
  const {sessionId}=await acquired.json() as {sessionId:string};
  const targetResponse=await env.BROWSER.fetch(`https://cloudflare.browser/v1/devtools/browser/${encodeURIComponent(sessionId)}/json/new?about:blank`,{method:'PUT'});
  if(!targetResponse.ok)throw new Error(`BROWSER_TARGET_${targetResponse.status}`);
  const target=await targetResponse.json() as {id:string};
  const upgraded=await env.BROWSER.fetch(`https://cloudflare.browser/v1/devtools/browser/${encodeURIComponent(sessionId)}/page/${encodeURIComponent(target.id)}`,{headers:{Upgrade:'websocket'}});
  const ws=(upgraded as any).webSocket as WebSocket|null;if(!ws)throw new Error('BROWSER_WEBSOCKET_MISSING');
  return {sessionId,cdp:new Cdp(ws)};
}

async function evaluate(cdp:Cdp,expression:string,timeout=30_000){
  const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'PAGE_EVALUATION_FAILED');
  return result.result?.value;
}

export async function processQuizBrowserJob(env:Env,queued:QuizJob){
  const owner=crypto.randomUUID();
  const claimed=await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'claim-job',{job_id:queued.jobId,owner});
  if(!claimed.job)return {ok:true,skipped:true,retry:claimed.status==='QUEUED'};
  const job=claimed.job;let sessionId:string|undefined,cdp:Cdp|undefined;
  try{
    if(job.expected_revision!==null&&job.expected_revision!==job.revision){return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,result:{ok:false,error:'REVISION_CONFLICT'}});}
    const opened=await openPage(env);sessionId=opened.sessionId;cdp=opened.cdp;
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:bridgeScript(queued.coreOrigin,job.id,owner)});
    const editor=(env.CORVO_APP_ORIGIN||'').replace(/\/$/,'')+'/quiz-studio/index.html';if(!editor.startsWith('https://'))throw new Error('CORVO_APP_ORIGIN_MISSING');
    await cdp.send('Page.navigate',{url:editor});
    const deadline=Date.now()+45_000;while(Date.now()<deadline){if(await evaluate(cdp,'Boolean(window.CorvoQuizStudio?.snapshot)',5000).catch(()=>false))break;await sleep(250);}if(Date.now()>=deadline)throw new Error('QUIZ_EDITOR_LOAD_TIMEOUT');
    const expression=`(async()=>{const job=${JSON.stringify(job)},api=window.CorvoQuizStudio;api.loadSnapshot(job.project);const result=await api.handle(job.command);if(!result.ok)return {result};const {externalize}=await import('/quiz-studio/host-client.js');const project=await externalize(api.snapshot(),window.__quizUpload);return {result,project,summary:api.getSummary()};})()`;
    const outcome=await evaluate(cdp,expression,13*60_000);
    return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,...outcome});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,result:{ok:false,error:message,renderer:'CLOUDFLARE_BROWSER_RENDERING'}}).catch(()=>({ok:false,error:message}));
  }finally{
    cdp?.close();if(sessionId&&env.BROWSER)await env.BROWSER.fetch(`https://cloudflare.browser/v1/devtools/browser/${encodeURIComponent(sessionId)}`,{method:'DELETE'}).catch(()=>undefined);
  }
}
