'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { readBrowserConnection } from '../../lib/browser-connection';

declare global { interface Window { CorvoLibrary?: any; } }
export default function QuizPage(){
  const frame=useRef<HTMLIFrameElement|null>(null),api=useRef<any>(null),active=useRef(''),revision=useRef(0),last=useRef(''),busy=useRef(false),conflict=useRef(false);
  const [items,setItems]=useState<any[]>([]),[id,setId]=useState(''),[message,setMessage]=useState('Conectando ao Librarynew…'),[loaded,setLoaded]=useState(false);
  async function request(path:string,body:any,media=false):Promise<any>{
    const c=readBrowserConnection();if(!c)throw Error('Abra Configurações da Library e conecte este navegador.');
    if(media){
      const upload=await request('rpc',{op:'upload-start',payload:{mime:body.type,size:body.size}}),parts:Array<{partNumber:number;etag:string}>=[];
      try{for(let offset=0;offset<body.size;offset+=8*1024*1024){
        const part:number=parts.length+1;const response:Response=await fetch(c.coreUrl.replace(/\/$/,'')+'/quiz/upload/'+upload.id+'/'+part,{method:'PUT',headers:{'x-corvo-app-key':c.appKey,'content-type':'application/octet-stream'},body:body.slice(offset,offset+8*1024*1024)});
        const value:any=await response.json();if(!response.ok||value.ok===false)throw Error(value.error||'Falha ao enviar mídia');parts.push({partNumber:value.partNumber,etag:value.etag});
      }return await request('rpc',{op:'upload-finish',payload:{id:upload.id,parts}});}
      catch(e){await request('rpc',{op:'upload-abort',payload:{id:upload.id}}).catch(()=>{});throw e;}
    }
    const serialized=JSON.stringify(body),large=serialized.length>3_000_000;
    const r=await fetch(large?c.coreUrl.replace(/\/$/,'')+'/quiz/'+path:'/api/core-proxy/quiz/'+path,{method:'POST',headers:{...(!large?{'x-corvo-core-url':c.coreUrl}:{}),'x-corvo-app-key':c.appKey,'content-type':'application/json'},body:serialized});
    const v=await r.json();if(!r.ok||v.ok===false)throw Error(v.error||'Falha na conexão');return v;
  }
  const rpc=(op:string,payload:any={})=>request('rpc',{op,payload});
  async function list(){const v=await rpc('list');setItems(v.items);return v.items;}
  async function open(next:string){
    if(busy.current)return;busy.current=true;setLoaded(false);
    try{const v=await rpc('read',{id:next,full:true});api.current.loadSnapshot(v.project);active.current=next;revision.current=v.revision;last.current=JSON.stringify(api.current.snapshot());conflict.current=false;setId(next);setLoaded(true);setMessage('Edição manual com salvamento automático.');}
    catch(e){setMessage((e as Error).message);}finally{busy.current=false;}
  }
  async function save(){
    if(!api.current||!active.current||busy.current||conflict.current)return;
    const raw=api.current.snapshot(),serial=JSON.stringify(raw);if(serial===last.current)return;
    busy.current=true;
    try{
      // This module is also used by the automatic executor.
      const moduleUrl='/quiz-studio/host-client.js';const {externalize}=await import(/* webpackIgnore: true */ moduleUrl);
      const project=await externalize(raw,(blob:Blob)=>request('media',blob,true));
      const r=await rpc('save',{id:active.current,expected_revision:revision.current,project,summary:api.current.getSummary()});revision.current=r.revision;last.current=serial;setMessage('Salvo · revisão '+r.revision);
    }catch(e){if((e as Error).message==='REVISION_CONFLICT'){conflict.current=true;setMessage('O MCP atualizou este quiz. Sua edição está preservada nesta tela: salve uma cópia antes de carregar a versão atual.');}else setMessage((e as Error).message);}
    finally{busy.current=false;}
  }
  useEffect(()=>{
    let closed=false;const connection=readBrowserConnection();if(!connection){setMessage('Abra Configurações da Library e conecte este navegador.');return;}
    window.CorvoLibrary={
      getConnection:()=>({connection_label:'Librarynew',core_url:connection.coreUrl,mcp_url:connection.coreUrl+'/mcp',push:true}),
      registerQuizStudio:()=>{},
      quizRequest:async(op:string,p:any)=>{
        if(op==='asset.resolve')return rpc(op,p);
        if(op==='media.upload')return request('media',p.blob,true);
        if(op==='quiz.state.push')return {ok:true}; // full autosave below is authoritative
        if(op==='quiz.visual.publish')return {ok:true}; // visuals are produced on demand
        if(op==='quiz.placement.read'){const s=api.current?.snapshot()?.scenes[api.current.getSummary().active_scene-1];if(!s?.lastPlacement)throw Error('Ainda não há placement salvo. Aplique coordenadas manualmente ou pelo MCP.');return {placement:s.lastPlacement};}
        throw Error('Operação de host desconhecida');
      }
    };
    const timer=setInterval(async()=>{
      if(closed)return;
      const studio=(frame.current?.contentWindow as any)?.CorvoQuizStudio;
      if(studio?.snapshot&&!api.current){api.current=studio;try{const all=await list();if(!closed){if(all.length)await open(all[0].id);else setMessage('Crie um quiz para começar.');}}catch(e){setMessage((e as Error).message);}return;}
      if(api.current&&active.current&&!busy.current&&!conflict.current){
        await save();if(busy.current||conflict.current)return;
        busy.current=true;try{const v=await rpc('read',{id:active.current,if_revision:revision.current});if(v.changed!==false&&v.revision!==revision.current){
          if(JSON.stringify(api.current.snapshot())!==last.current)return;
          const full=await rpc('read',{id:active.current,full:true});
          // Recheck after the network request: a user may have typed meanwhile.
          if(JSON.stringify(api.current.snapshot())!==last.current)return;
          api.current.loadSnapshot(full.project);revision.current=full.revision;last.current=JSON.stringify(api.current.snapshot());setMessage('Atualizado pelo MCP · revisão '+full.revision);
        }}catch(e){setMessage((e as Error).message);}finally{busy.current=false;}
      }
    },1500);
    return()=>{closed=true;clearInterval(timer);delete window.CorvoLibrary;};
  },[]);
  async function create(){try{await save();if(conflict.current)return;const v=await rpc('create',{id:crypto.randomUUID(),title:'Quiz Teste'});await list();await open(v.id);}catch(e){setMessage((e as Error).message);}}
  async function select(next:string){await save();if(!conflict.current)await open(next);}
  return <main style={{height:'100dvh',display:'flex',flexDirection:'column',background:'#101621',color:'#fff'}}>
    <header style={{display:'flex',gap:14,padding:12,alignItems:'center',flexWrap:'wrap'}}><a href="/" style={{color:'#ffd447'}}>← Librarynew</a><strong>Quiz Teste</strong><select aria-label="Quiz" value={id} onChange={(e:ChangeEvent<HTMLSelectElement>)=>void select(e.target.value)}><option value="">Selecionar quiz</option>{items.map(x=><option key={x.id} value={x.id}>{x.title} · {x.id.slice(0,8)}</option>)}</select><button onClick={()=>void create()}>Novo quiz</button><button onClick={()=>void save()}>Salvar</button><button onClick={()=>{const blob=new Blob([JSON.stringify(api.current?.snapshot())],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='quiz-copia-local.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}}>Salvar cópia</button><button onClick={()=>void open(id)} disabled={!id}>Carregar versão salva</button><small role="status">{message}</small></header>
    <iframe ref={frame} title="Editor Quiz Teste" src="/quiz-studio/index.html" style={{border:0,width:'100%',flex:1,visibility:loaded?'visible':'hidden'}} allow="autoplay; fullscreen" />
  </main>;
}
