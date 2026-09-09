import {env,rpc,quizRpc,serveQuizMedia,uploadQuizPart} from './quiz-fixture.mjs';
import {createServer} from 'node:http';import {spawn,execFileSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const url=`http://127.0.0.1:${server.address().port}${req.url}`,r=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});let value;
 if(req.url==='/quiz/rpc'){const b=await r.json();value=await quizRpc(env,r,b.op,b.payload);}
 else if(req.url.startsWith('/quiz/upload/')){const parts=req.url.split('/');value=await uploadQuizPart(env,r,parts[3],Number(parts[4]));}
 else if(req.url.startsWith('/quiz/media/')){const m=await serveQuizMedia(env,r,req.url.split('/').pop());res.writeHead(m.status,Object.fromEntries(m.headers));res.end(Buffer.from(await m.arrayBuffer()));return;}
 else throw Error('UNKNOWN_ROUTE');res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=spawn(process.execPath,['quiz-executor/runner.mjs'],{env:{...process.env,CORVO_CORE_URL:`http://127.0.0.1:${server.address().port}`,CORVO_APP_KEY:'test-only',CHROME_EXECUTABLE:process.env.CHROME_EXECUTABLE||'/tmp/chromium'},stdio:['ignore','pipe','pipe']});
worker.stdout.on('data',b=>process.stdout.write(b));worker.stderr.on('data',b=>process.stderr.write(b));
async function command(op,args={}){const q=await rpc('execute',{id:'e2e',request_id:crypto.randomUUID(),command:{op,...args}});const end=Date.now()+180_000;while(Date.now()<end){const s=await rpc('job',{job_id:q.id});if(['SUCCEEDED','FAILED','CANCELLED'].includes(s.status)){assert.equal(s.status,'SUCCEEDED',JSON.stringify(s));return s.result;}await new Promise(r=>setTimeout(r,500));}throw Error('TIMEOUT '+op);}
try{
 await rpc('create',{id:'e2e',title:'Headless'});
 const schema=await command('get_schema');assert.ok(schema.editable_example);console.log('MCP discovery ready');
 await command('apply',{scene:1,patch:{title:'HEADLESS REAL',duration:1}});
 const visual=await command('get_visual',{scene:1});const png=await fetch(visual.preview_url);assert.equal(png.headers.get('content-type'),'image/png');assert.ok((await png.arrayBuffer()).byteLength>1000);
 const video=await command('export_scene_mp4',{scene:1});assert.equal(video.audio_backend,'ffmpeg-aac');const bytes=Buffer.from(await (await fetch(video.download_url)).arrayBuffer());await writeFile('/tmp/quiz-headless.mp4',bytes);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json','/tmp/quiz-headless.mp4'],{encoding:'utf8'}));assert.ok(probe.streams.some(s=>s.codec_name==='h264'));assert.ok(probe.streams.some(s=>s.codec_name==='aac'));assert.equal(probe.streams.find(s=>s.codec_type==='video').width,1920);
 console.log('PASS: headless queue → exact editor → PNG → MP4 H264/AAC → multipart storage → download');
}finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('exit',r));server.close();}
