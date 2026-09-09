import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
await build({entryPoints:['cloudflare/src/quiz/service.ts'],outfile:'.generated/quiz-service-test.mjs',bundle:true,platform:'node',format:'esm'});
const {quizRpc,serveQuizMedia,uploadQuizMedia,uploadQuizPart}=await import('../.generated/quiz-service-test.mjs');
const sqlite=new DatabaseSync(':memory:');
const DB={exec:async(sql)=>sqlite.exec(sql),prepare(sql){return {bind(...values){return {first:async()=>sqlite.prepare(sql).get(...values)||null,all:async()=>({results:sqlite.prepare(sql).all(...values),success:true}),run:async()=>({success:true,meta:sqlite.prepare(sql).run(...values)})};},first:async()=>sqlite.prepare(sql).get()||null};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const store=new Map(),uploads=new Map();
const MEDIA={async put(key,data){store.set(key,new Uint8Array(typeof data==='string'?new TextEncoder().encode(data):data));},async get(key,opts){const data=store.get(key);if(!data)return null;const b=opts?.range?data.slice(opts.range.offset,opts.range.offset+opts.range.length):data;return {text:async()=>new TextDecoder().decode(b),body:new Response(b).body,arrayBuffer:async()=>b.buffer};},async delete(k){store.delete(k)},async createMultipartUpload(k){const uploadId=crypto.randomUUID();uploads.set(uploadId,{key:k,parts:new Map()});return {uploadId};},resumeMultipartUpload(k,id){const u=uploads.get(id);return {async uploadPart(n,b){u.parts.set(n,new Uint8Array(b));return {partNumber:n,etag:String(n)};},async complete(parts){const bytes=Buffer.concat(parts.map(p=>u.parts.get(p.partNumber)));store.set(k,bytes);return {size:bytes.length};},async abort(){uploads.delete(id)}};}};
const env={DB,MEDIA},request=new Request('https://core.example/quiz/rpc');
const rpc=(op,p={})=>quizRpc(env,request,op,p);
const project={version:4,scenes:[{title:'Manual',format:'16:9'}],active_scene:1,audio:null};


export {env,rpc,quizRpc,serveQuizMedia,uploadQuizMedia,uploadQuizPart,project,sqlite};
