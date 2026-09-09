import {mkdtemp,rm,open,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function muxAudio({core,key,rpc,video_url,audio_url,track,duration,signal}){
  if(!Number.isFinite(duration)||duration<=0)throw Error('INVALID_DURATION');
  const dir=await mkdtemp(path.join(tmpdir(),'corvo-quiz-'));
  async function download(url,file){const u=new URL(url);if(u.origin!==new URL(core).origin||!/^\/quiz\/media\/[\w-]+$/.test(u.pathname))throw Error('INVALID_MUX_MEDIA');const r=await fetch(url,{redirect:'error',signal});if(!r.ok)throw Error('MUX_MEDIA_UNAVAILABLE');await pipeline(Readable.fromWeb(r.body),createWriteStream(file),{signal});}
  try{
    const video=path.join(dir,'video.mp4'),audio=path.join(dir,'audio'),output=path.join(dir,'result.mp4');
    await Promise.all([download(video_url,video),download(audio_url,audio)]);
    const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',audio],{signal});
    const sourceDuration=Number(stdout.trim());if(!sourceDuration)throw Error('INVALID_AUDIO');
    const play=track.loop?duration:Math.min(duration,sourceDuration),fi=Math.max(0,Number(track.fadeIn)||0),fo=Math.max(0,Number(track.fadeOut)||2),vol=Math.max(0,Math.min(1,Number(track.volume)||0));
    // Same min-envelope as the original renderer, including overlapping fades.
    const gain=`${vol}*min(${fi?`min(1,t/${fi})`:'1'},${fo?`min(1,max(0,(${play}-t)/${fo}))`:'1'})`;
    const filter=`aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${play},aeval=exprs='val(0)*${gain}|val(1)*${gain}':c=stereo,apad,atrim=duration=${duration},aformat=channel_layouts=stereo`;
    await exec('ffmpeg',['-nostdin','-v','error','-y','-i',video,...(track.loop?['-stream_loop','-1']:[]),'-i',audio,'-map','0:v:0','-map','1:a:0','-af',filter,'-c:v','copy','-ac','2','-channel_layout','stereo','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',output],{signal,maxBuffer:1024*1024});
    const size=(await stat(output)).size,start=await rpc('upload-start',{mime:'video/mp4',size}),parts=[],file=await open(output,'r');
    try{
      const buffer=Buffer.alloc(8*1024*1024);let offset=0;while(offset<size){signal?.throwIfAborted();const {bytesRead}=await file.read(buffer,0,buffer.length,offset);if(!bytesRead)throw Error('OUTPUT_READ_FAILED');const r=await fetch(`${core}/quiz/upload/${start.id}/${parts.length+1}`,{method:'PUT',headers:{'x-corvo-app-key':key},body:buffer.subarray(0,bytesRead),signal});const p=await r.json();if(!r.ok)throw Error(p.error||'UPLOAD_FAILED');parts.push({partNumber:p.partNumber,etag:p.etag});offset+=bytesRead;}return {...await rpc('upload-finish',{id:start.id,parts}),audio_backend:'ffmpeg-aac'};
    }catch(e){await rpc('upload-abort',{id:start.id}).catch(()=>{});throw e;}finally{await file.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
}
