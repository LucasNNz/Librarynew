import type { Env, QuizJob } from '../types';
import { hasActiveLocalExecutors, quizRpc } from './service';

type Pending={resolve:(value:any)=>void,reject:(error:Error)=>void,timer:number};

class Cdp {
  private next=1;
  private pending=new Map<number,Pending>();
  constructor(private ws:WebSocket){
    (ws as any).accept?.();
    ws.addEventListener('message',(event:any)=>{
      try{
        const raw=typeof event.data==='string'?event.data:new TextDecoder().decode(event.data);
        const msg=JSON.parse(raw);if(!msg.id)return;const p=this.pending.get(msg.id);if(!p)return;
        this.pending.delete(msg.id);clearTimeout(p.timer);
        msg.error?p.reject(new Error(msg.error.message||'CDP_ERROR')):p.resolve(msg.result);
      }catch{/* browser events do not belong to a pending request */}
    });
    ws.addEventListener('close',()=>this.rejectAll(new Error('BROWSER_SESSION_CLOSED')));
    ws.addEventListener('error',()=>this.rejectAll(new Error('BROWSER_SESSION_ERROR')));
  }
  private rejectAll(error:Error){for(const [,p] of this.pending){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  send(method:string,params:any={},timeout=30_000,sessionId?:string){
    const id=this.next++;
    return new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP_TIMEOUT:${method}`));},timeout) as unknown as number;
      this.pending.set(id,{resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  close(){try{this.ws.close(1000,'done');}catch{/* already closed */}}
}

const BROWSER_HOST='https://fake.host';
const BROWSER_KEEP_ALIVE_MS=600_000;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

const LOCAL_PRIORITY_GRACE_MS=12_000;
const LOCAL_PRIORITY_POLL_MS=1_500;

async function waitForLocalPriority(env:Env,queued:QuizJob){
  const deadline=Date.now()+LOCAL_PRIORITY_GRACE_MS;
  while(Date.now()<deadline){
    if(!await hasActiveLocalExecutors(env))return false;
    const state=await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'job',{job_id:queued.jobId}).catch(()=>null);
    if(!state||state.status!=='QUEUED')return true;
    await sleep(LOCAL_PRIORITY_POLL_MS);
  }
  return false;
}

const bridgeScript=(coreOrigin:string,jobId:string,owner:string)=>`(()=>{
  const core=${JSON.stringify(coreOrigin)},headers={'content-type':'application/json','x-quiz-job':${JSON.stringify(jobId)},'x-quiz-owner':${JSON.stringify(owner)}};
  async function rpc(op,payload={}){const r=await fetch(core+'/quiz/executor/rpc',{method:'POST',headers,body:JSON.stringify({op,payload})});const v=await r.json();if(!r.ok||v.ok===false)throw Error(v.error||('HTTP_'+r.status));return v;}
  async function upload(blob){const start=await rpc('upload-start',{mime:blob.type||'application/octet-stream',size:blob.size}),parts=[];try{for(let i=0;i<blob.size;i+=8*1024*1024){const r=await fetch(core+'/quiz/executor/upload/'+encodeURIComponent(start.id)+'/'+(parts.length+1),{method:'PUT',headers:{'x-quiz-job':${JSON.stringify(jobId)},'x-quiz-owner':${JSON.stringify(owner)},'content-type':'application/octet-stream'},body:await blob.slice(i,i+8*1024*1024).arrayBuffer()});const v=await r.json();if(!r.ok)throw Error(v.error||'UPLOAD_FAILED');parts.push({partNumber:v.partNumber,etag:v.etag});}return await rpc('upload-finish',{id:start.id,parts});}catch(e){await rpc('upload-abort',{id:start.id}).catch(()=>{});throw e;}}
  window.__quizUpload=upload;
  window.CorvoLibrary={serverAudio:false,getConnection:()=>({connection_label:'Librarynew Core renderer',push:true,headless:true}),registerQuizStudio:()=>{},quizRequest:async(op,p)=>{if(op==='asset.resolve')return rpc(op,p);if(op==='media.upload')return upload(p.blob);if(['quiz.state.push','quiz.visual.publish'].includes(op))return {ok:true};throw Error('UNSUPPORTED_HOST_OPERATION:'+op);}};
})();`;

async function openPage(env:Env){
  if(!env.BROWSER)throw new Error('BROWSER_BINDING_MISSING');
  // Browser bindings are Fetchers whose hostname is intentionally ignored by
  // Cloudflare. The official @cloudflare/puppeteer client uses fake.host and
  // these exact /v1 endpoints. Do not use public API hostnames here.
  const acquired=await env.BROWSER.fetch(`${BROWSER_HOST}/v1/devtools/browser?keep_alive=${BROWSER_KEEP_ALIVE_MS}`,{method:'POST'});
  const acquiredText=await acquired.text();
  if(!acquired.ok)throw new Error(`BROWSER_ACQUIRE_${acquired.status}:${acquiredText.slice(0,400)}`);
  let browserSessionId='';
  try{browserSessionId=String((JSON.parse(acquiredText) as {sessionId?:string}).sessionId||'');}catch{throw new Error('BROWSER_ACQUIRE_INVALID_JSON');}
  if(!browserSessionId)throw new Error('BROWSER_SESSION_ID_MISSING');

  const upgraded=await env.BROWSER.fetch(`${BROWSER_HOST}/v1/devtools/browser/${encodeURIComponent(browserSessionId)}`,{
    headers:{Upgrade:'websocket','cf-brapi-client':'corvo-library-cdp@0.20.63'}
  });
  if(upgraded.status!==101&&!(upgraded as any).webSocket)throw new Error(`BROWSER_WEBSOCKET_${upgraded.status}`);
  const ws=(upgraded as any).webSocket as WebSocket|null;if(!ws)throw new Error('BROWSER_WEBSOCKET_MISSING');
  const cdp=new Cdp(ws);

  // The current binding exposes the standard browser-level CDP websocket.
  // Create a page target and attach with flattened sessions so Page/Runtime
  // commands are routed to that target without needing the legacy /page URL.
  const created=await cdp.send('Target.createTarget',{url:'about:blank'});
  const targetId=String(created?.targetId||'');if(!targetId)throw new Error('BROWSER_TARGET_MISSING');
  const attached=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const pageSessionId=String(attached?.sessionId||'');if(!pageSessionId)throw new Error('BROWSER_PAGE_SESSION_MISSING');
  return {browserSessionId,targetId,pageSessionId,cdp};
}

async function evaluate(cdp:Cdp,pageSessionId:string,expression:string,timeout=30_000){
  const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout,pageSessionId);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'PAGE_EVALUATION_FAILED');
  return result.result?.value;
}

export async function processQuizBrowserJob(env:Env,queued:QuizJob){
  if(await waitForLocalPriority(env,queued))return {ok:true,skipped:true,reason:'LOCAL_BROWSER_PRIORITY'};
  const owner=crypto.randomUUID();
  const claimed=await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'claim-job',{job_id:queued.jobId,owner});
  if(!claimed.job)return {ok:true,skipped:true,retry:claimed.status==='QUEUED'};
  const job=claimed.job;
  let cdp:Cdp|undefined,pageSessionId:string|undefined,targetId:string|undefined;
  let stopped=false,cancelRequested=false,heartbeatTimer:any;
  try{
    if(job.expected_revision!==null&&job.expected_revision!==job.revision){return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,result:{ok:false,error:'REVISION_CONFLICT'}});}
    const opened=await openPage(env);cdp=opened.cdp;pageSessionId=opened.pageSessionId;targetId=opened.targetId;
    await cdp.send('Page.enable',{},30_000,pageSessionId);await cdp.send('Runtime.enable',{},30_000,pageSessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:bridgeScript(queued.coreOrigin,job.id,owner)},30_000,pageSessionId);
    const editor=(env.CORVO_APP_ORIGIN||'').replace(/\/$/,'')+'/quiz-studio/index.html';if(!editor.startsWith('https://'))throw new Error('CORVO_APP_ORIGIN_MISSING');
    await cdp.send('Page.navigate',{url:editor},30_000,pageSessionId);
    const deadline=Date.now()+45_000;while(Date.now()<deadline){if(await evaluate(cdp,pageSessionId,'Boolean(window.CorvoQuizStudio?.snapshot)',5000).catch(()=>false))break;await sleep(250);}if(Date.now()>=deadline)throw new Error('QUIZ_EDITOR_LOAD_TIMEOUT');

    // Keep both the Browser Run session and the D1 lease alive during long MP4
    // exports. Browser.getVersion is browser-scoped, so it remains responsive
    // even while the page is busy encoding video.
    const heartbeat=async()=>{
      if(stopped||!cdp)return;
      await cdp.send('Browser.getVersion',{},7_500).catch(()=>undefined);
      const hb=await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'heartbeat',{owner,job_id:job.id}).catch(()=>null);
      if(hb?.cancel)cancelRequested=true;
    };
    await heartbeat();
    heartbeatTimer=setInterval(()=>{void heartbeat();},25_000);

    const expression=`(async()=>{const job=${JSON.stringify(job)},api=window.CorvoQuizStudio;api.loadSnapshot(job.project);const result=await api.handle(job.command);if(!result.ok)return {result};const {externalize}=await import('/quiz-studio/host-client.js');const project=await externalize(api.snapshot(),window.__quizUpload);return {result,project,summary:api.getSummary()};})()`;
    const outcome=await evaluate(cdp,pageSessionId,expression,13*60_000);
    if(cancelRequested)outcome.result={ok:false,error:'CANCEL_REQUESTED'};
    return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,...outcome});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return await quizRpc(env,new Request(queued.coreOrigin+'/quiz/rpc'),'complete',{owner,job_id:job.id,revision:job.revision,result:{ok:false,error:message,renderer:'CLOUDFLARE_BROWSER_RENDERING'}}).catch(()=>({ok:false,error:message}));
  }finally{
    stopped=true;if(heartbeatTimer)clearInterval(heartbeatTimer);
    if(cdp){
      if(targetId)await cdp.send('Target.closeTarget',{targetId},5_000).catch(()=>undefined);
      await cdp.send('Browser.close',{},5_000).catch(()=>undefined);
      cdp.close();
    }
  }
}
