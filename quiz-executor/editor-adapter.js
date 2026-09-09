  // Inserted inside the original exporter scope: manual UI and MCP use exactly
  // the same scene normalizers, layout code and Canvas/WebCodecs renderer.
  const librarySnapshot=()=>({version:4,kind:'corvo-project',active_scene:activeScene+1,selected_scenes:scenes.flatMap((s,i)=>selection.has(s)?[i+1]:[]),audio:deepClone(projectAudioTrack),scenes:scenes.map(s=>ensureSceneExtras(deepClone(s)))});
  function libraryLoad(project){
    const p=project||{scenes:[initial()],audio:bundledProjectAudio(),active_scene:1};
    if(!Array.isArray(p.scenes)||!p.scenes.length||p.scenes.length>1000)throw Error('INVALID_PROJECT');
    const next=p.scenes.map(s=>ensureSceneExtras(merge(initial(),deepClone(s))));
    scenes=next;activeScene=Math.max(0,Math.min(next.length-1,(Number(p.active_scene)||1)-1));state=scenes[activeScene];
    projectAudioTrack=normalizeProjectAudio(p.audio);selection.clear();for(const n of p.selected_scenes||[])if(scenes[n-1])selection.add(scenes[n-1]);render();syncV2Ui();dirty=false;
  }
  async function libraryHydrate(patch){
    const p=deepClone(patch||{});
    const resolve=async(id)=>{const a=await libraryRequest('asset.resolve',{asset_id:id});if(!a?.url)throw Error('ASSET_NOT_FOUND: '+id);return a.url;};
    for(const k of OPTION_KEYS){if(!p[k])continue;const x=p[k],id=x.asset_id||x.assetId,url=x.image_url||x.imageUrl||x.url;
      if(id||url){x.image=null;x.assetId=id||'';x.imageUrl=id?await resolve(id):url;}if(x.clearImage){x.image=null;x.assetId='';x.imageUrl='';}delete x.asset_id;delete x.image_url;delete x.url;delete x.clearImage;
    }
    if(p.background_asset_id||p.backgroundAssetId){p.backgroundAssetId=p.background_asset_id||p.backgroundAssetId;p.backgroundUrl=await resolve(p.backgroundAssetId);p.background=null;delete p.background_asset_id;}
    if(p.background_video_asset_id){p.backgroundVideoAssetId=p.background_video_asset_id;p.backgroundVideoUrl=await resolve(p.backgroundVideoAssetId);p.backgroundVideo=null;delete p.background_video_asset_id;}
    if(p.clearBackground){p.background=null;p.backgroundUrl='';p.backgroundAssetId='';p.backgroundVideo=null;p.backgroundVideoUrl='';p.backgroundVideoAssetId='';delete p.clearBackground;}
    if(p.overlays)for(const x of p.overlays){const id=x.asset_id||x.assetId,url=x.image_url||x.imageUrl;if(id||url){x.image=null;x.assetId=id||'';x.imageUrl=id?await resolve(id):url;}delete x.asset_id;delete x.image_url;}
    return p;
  }
  async function libraryRefreshAssets(){
    // Signed Library URLs expire. Resolve each asset once per command, including
    // restored scenes and overlays, before preview/export.
    const urls=new Map();const resolve=async(id)=>{if(!urls.has(id))urls.set(id,libraryRequest('asset.resolve',{asset_id:id}).then(x=>{if(!x.url)throw Error('ASSET_NOT_FOUND: '+id);return x.url}));return urls.get(id)};
    for(const s of scenes){for(const k of OPTION_KEYS)if(s[k].assetId)s[k].imageUrl=await resolve(s[k].assetId);for(const x of s.overlays||[])if(x.assetId)x.imageUrl=await resolve(x.assetId);if(s.backgroundAssetId)s.backgroundUrl=await resolve(s.backgroundAssetId);if(s.backgroundVideoAssetId)s.backgroundVideoUrl=await resolve(s.backgroundVideoAssetId);}
    if(projectAudioTrack.assetId)projectAudioTrack.src=await resolve(projectAudioTrack.assetId);
    render();
  }
  const librarySceneIndex=(v)=>{const n=v===undefined?activeScene+1:v;if(!Number.isInteger(n)||n<1||n>scenes.length)throw Error('INVALID_SCENE');return n-1;};
  const libraryUpload=(blob,kind)=>libraryRequest('media.upload',{blob,kind},120000);
  async function libraryVisual(req){
    const idx=librarySceneIndex(req.scene),s=deepClone(scenes[idx]),{w,h}=sceneCanvas(s.format),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    await libraryRefreshAssets();Object.assign(s,deepClone(scenes[idx]));await prewarmExportAssets([s]);await paintCorvoExportFrame(canvas,s,Number(req.time)||0,idx);
    const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG_FAILED')),'image/png'));
    const preview=await libraryUpload(png,'preview');const ctx=canvas.getContext('2d');ctx.save();ctx.strokeStyle='#00e5ff';ctx.fillStyle='#001720';ctx.lineWidth=2;ctx.font='20px sans-serif';
    for(let n=10;n<100;n+=10){ctx.beginPath();ctx.moveTo(w*n/100,0);ctx.lineTo(w*n/100,h);ctx.moveTo(0,h*n/100);ctx.lineTo(w,h*n/100);ctx.stroke();ctx.fillText(n+'%',w*n/100+3,24);}
    for(const [k,b] of Object.entries(s.layout?.options||{})){ctx.strokeStyle='#ff3864';ctx.strokeRect(b.x*w/100,b.y*h/100,b.w*w/100,b.h*h/100);ctx.fillText(k.toUpperCase(),b.x*w/100+6,b.y*h/100+24);}ctx.restore();
    const debug=await libraryUpload(await new Promise(r=>canvas.toBlob(r,'image/png')),'debug');
    return {ok:true,scene:idx+1,width:w,height:h,preview_url:preview.url,debug_url:debug.url,coordinates:exportScenePackage(idx).coordinates_txt};
  }
  async function libraryApply(req){
    const op=req.op;const idx=()=>librarySceneIndex(req.scene);
    if(op==='set_control'){
      const el=document.getElementById(String(req.id));
      if(!el||!el.closest('main')||!['INPUT','SELECT','TEXTAREA'].includes(el.tagName)||['file','password','button','submit'].includes(el.type)||el.disabled||el.readOnly)throw Error('CONTROL_NOT_EDITABLE_USE_EXPLICIT_COMMAND');
      if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===String(req.value)))throw Error('INVALID_CONTROL_VALUE');
      if(el.type==='checkbox')el.checked=Boolean(req.value);else el.value=String(req.value??'');
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,updated:1};
    }
    if(op==='set_playback'){if(req.restart)$('#restart').click();if(typeof req.paused==='boolean'&&paused!==req.paused)$('#pause').click();return {ok:true,paused};}
    if(op==='set_editor_visible'){const visible=req.visible!==false;if(document.body.classList.contains('editor-hidden')===visible)$('#toggleEditor').click();return {ok:true,visible};}
    if(op==='import_scenes'){if(!Array.isArray(req.scenes)||!req.scenes.length||scenes.length+req.scenes.length>1000)throw Error('INVALID_SCENES');for(const scene of req.scenes)insertScene(scenes.length-1,await libraryHydrate(scene));return {ok:true,updated:req.scenes.length};}
    if(op==='export_overlay_placement'){
      const n=Number(req.slot),s=scenes[idx()];if(!Number.isInteger(n)||n<1||n>3)throw Error('INVALID_OVERLAY_SLOT');const x=s.overlays[n-1],canvas=sceneCanvas(s.format);
      const text=['SET_SCENE_PLACEMENT',`REFERENCE_WIDTH=${canvas.w}`,`REFERENCE_HEIGHT=${canvas.h}`,`PNG_${n}_CENTER_X=${x.x}%`,`PNG_${n}_BASE_Y=${x.y}%`,`PNG_${n}_SCALE=${x.scale}`,`PNG_${n}_DEPTH=${x.depth}`,`PNG_${n}_NAME=${x.name}`].join('\n');
      const file=await libraryUpload(new Blob([text],{type:'text/plain'}),'placement');return {ok:true,download_url:file.url,text};
    }
    if(op==='get_schema')return {ok:true,schema:schemaData(),editable_example:librarySnapshot().scenes[activeScene],audio:deepClone(projectAudioTrack),commands:window.CorvoQuizStudio.capabilities().commands,patch_semantics:'Recursive object merge; arrays replaced in full; scenes 1-based. Every field in editable_example can be patched. asset_id works for options, overlays, background; set_audio accepts asset_id.',controls:Array.from(document.querySelectorAll('input,select,button,textarea')).filter(e=>e.id).map(e=>({id:e.id,type:e.type,label:(e.getAttribute('aria-label')||e.closest('label')?.textContent||e.textContent||'').trim().slice(0,100)}))};
    if(op==='get_state'||op==='summary')return {ok:true,...studioSummary()};
    if(op==='get_project')return {ok:true,project:req.full?librarySnapshot():projectData(false)};
    if(op==='get_scene')return {ok:true,scene:deepClone(scenes[idx()])};
    if(['apply','set_scene'].includes(op)){const i=idx(),wasSelected=selection.has(scenes[i]);const old=scenes[i];assignScene(i,await libraryHydrate(req.patch));if(wasSelected){selection.delete(old);selection.add(scenes[i]);}return {ok:true,updated:1};}
    if(['apply_placement','set_scene_placement'].includes(op)){const i=idx();scenes[i]=applyScenePlacement(deepClone(scenes[i]),req.placement||req.patch);state=scenes[activeScene];render();return {ok:true,updated:1};}
    if(['apply_batch','set_many'].includes(op)){
      const list=req.operations||req.ops;if(!Array.isArray(list)||!list.length||list.length>200)throw Error('BATCH_REQUIRES_1_TO_200_OPERATIONS');
      const allowed=['apply','set_scene','apply_placement','set_scene_placement','set_active_scene','add_scene','add_text_scene','duplicate_scene','delete_scene','move_scene','reset_scene','auto_layout','apply_to_selection'];
      for(const x of list)if(!allowed.includes(x.op))throw Error('INVALID_BATCH_OPERATION: '+x.op);
      for(const x of list)await libraryApply(x);return {ok:true,updated:list.length};
    }
    if(op==='add_scene'||op==='add_text_scene'){if(scenes.length>=1000)throw Error('SCENE_LIMIT');const after=req.after===undefined?scenes.length-1:librarySceneIndex(req.after);const patch=await libraryHydrate(req.scene_data||req.patch||(typeof req.scene==='object'?req.scene:{}));insertScene(after,op==='add_text_scene'?merge(window.CorvoQuizStudio.createTextScene(),patch):patch);return {ok:true,updated:1};}
    if(op==='duplicate_scene'){if(scenes.length>=1000)throw Error('SCENE_LIMIT');const i=idx();scenes.splice(i+1,0,deepClone(scenes[i]));switchScene(i+1);return {ok:true,updated:1};}
    if(op==='delete_scene'){deleteSceneAt(idx());return {ok:true,updated:1};}
    if(op==='move_scene'){if(!Number.isInteger(req.to))throw Error('INVALID_DESTINATION');moveSceneTo(idx(),req.to);return {ok:true,updated:1};}
    if(op==='set_active_scene'){switchScene(idx());return {ok:true,updated:1};}
    if(op==='replace_project'){libraryLoad(req.project);return {ok:true,updated:scenes.length};}
    if(op==='reset_scene'){const i=idx();scenes[i]=ensureSceneExtras(initial());state=scenes[activeScene];render();return {ok:true,updated:1};}
    if(op==='set_audio'){const audio=deepClone(req.audio||null);if(audio?.asset_id){const a=await libraryRequest('asset.resolve',{asset_id:audio.asset_id});if(!a.url)throw Error('ASSET_NOT_FOUND');audio.src=a.url;audio.assetId=audio.asset_id;delete audio.asset_id;}projectAudioTrack=normalizeProjectAudio(audio);if(audio?.assetId)projectAudioTrack.assetId=audio.assetId;syncV2Ui();return {ok:true,updated:1};}
    if(op==='set_selection'){const list=req.scenes||[];const indexes=list.map(librarySceneIndex);selection.clear();for(const i of indexes)selection.add(scenes[i]);drawStrip();return {ok:true,selected:list};}
    if(op==='apply_to_selection'){const targets=req.scenes?req.scenes.map(librarySceneIndex):scenes.flatMap((s,i)=>selection.has(s)?[i]:[]);if(!targets.length)throw Error('EMPTY_SELECTION');const patch=await libraryHydrate(req.patch);for(const i of targets)assignScene(i,patch);return {ok:true,updated:targets.length};}
    if(op==='auto_layout'){const i=idx();applyAutoOptionLayout(scenes[i]);state=scenes[activeScene];render();return {ok:true,updated:1};}
    if(op==='get_coordinates')return {ok:true,...exportScenePackage(idx())};
    if(['get_visual','export_scene','export_scene_package','export_png'].includes(op))return libraryVisual(req);
    if(op==='export_project'){const data=await libraryUpload(new Blob([JSON.stringify(librarySnapshot())],{type:'application/json'}),'project');return {ok:true,download_url:data.url};}
    if(op==='get_diagnostics')return {ok:true,diagnostics:window.CorvoExporter.getDiagnostics()};
    if(op==='present'){document.body.classList.add('presenting');return {ok:true};}
    if(op==='stop_present'){document.body.classList.remove('presenting');return {ok:true};}
    if(op==='export_scene_mp4'||op==='export_project_mp4'){
      if(exportBusy)throw Error('EXPORT_BUSY');await libraryRefreshAssets();const list=op==='export_scene_mp4'?[deepClone(scenes[idx()])]:scenes.filter(s=>!req.format||s.format===req.format).map(deepClone);
      if(!list.length)throw Error('NO_SCENES');if(new Set(list.map(s=>s.format)).size>1)throw Error('MIXED_FORMATS_SELECT_16:9_OR_9:16');
      exportAbortController=new AbortController();exportSetBusy(true);let rendered;const savedAudio=deepClone(projectAudioTrack),serverAudio=!!getDirectLibrary()?.serverAudio&&!!projectAudioSource();
      try{
        if(serverAudio)projectAudioTrack=normalizeProjectAudio(null);
        rendered=await renderCorvoMp4V2(list,{project:op==='export_project_mp4',signal:exportAbortController.signal});
        projectAudioTrack=savedAudio;let media=await libraryUpload(rendered.blob,'mp4');
        if(serverAudio){const response=await fetch(projectAudioSource(savedAudio));if(!response.ok)throw Error('AUDIO_UNAVAILABLE');const audio=await libraryUpload(await response.blob(),'audio');media=await libraryRequest('video.mux',{video_url:media.url,audio_url:audio.url,track:savedAudio,duration:rendered.duration},3600000);}
        return {ok:true,download_url:media.url,width:rendered.width,height:rendered.height,audio_backend:media.audio_backend||'webcodecs',diagnostics:window.CorvoExporter.getDiagnostics()};
      }finally{projectAudioTrack=savedAudio;await rendered?.cleanup?.();exportAbortController=null;exportSetBusy(false);}
    }
    throw Error('UNKNOWN_COMMAND: '+op);
  }
  const originalLibraryHandle=handleStudioCommand;
  let libraryExecuting=false;
  async function libraryExecute(req){
    if(libraryExecuting)return {ok:false,error:'EDITOR_BUSY'};
    libraryExecuting=true;const before=librarySnapshot(),selected=scenes.flatMap((s,i)=>selection.has(s)?[i]:[]);
    try{const result=await libraryApply(req);return {...result,active_scene:activeScene+1,total_scenes:scenes.length};}
    catch(e){libraryLoad(before);for(const i of selected)selection.add(scenes[i]);return {ok:false,error:e?.message||'QUIZ_FAILED'};}
    finally{libraryExecuting=false;}
  }
  window.CorvoQuizStudio.handle=libraryExecute;window.CorvoQuizStudio.run=libraryExecute;
  window.CorvoQuizStudio.snapshot=librarySnapshot;window.CorvoQuizStudio.loadSnapshot=libraryLoad;
  window.CorvoQuizStudio.cancel=()=>exportAbortController?.abort();
  window.CorvoQuizStudio.capabilities=()=>({version:'library-quiz/v2',batch:true,max_batch_ops:200,commands:['get_schema','get_state','get_project','get_scene','summary','apply','set_scene','apply_batch','set_many','apply_placement','set_scene_placement','set_active_scene','add_scene','add_text_scene','duplicate_scene','delete_scene','move_scene','replace_project','set_audio','reset_scene','set_selection','apply_to_selection','auto_layout','get_coordinates','get_visual','export_scene','export_scene_package','export_png','export_scene_mp4','export_project_mp4','export_project','get_diagnostics','present','stop_present','set_control','set_playback','set_editor_visible','import_scenes','export_overlay_placement']});
  // Replace the lexical handler used by the legacy postMessage/direct bridge too.
  handleStudioCommand=libraryExecute;
