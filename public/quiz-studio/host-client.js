// Shared manual/headless transport. All file bytes go directly to the host,
// never into MCP arguments/results. No credentials are passed to the Studio.
export async function externalize(project, upload) {
  const memo=new Map();
  async function walk(v){
    if(typeof v==='string'&&v.startsWith('data:')){if(!memo.has(v))memo.set(v,fetch(v).then(r=>r.blob()).then(upload).then(r=>r.url));return memo.get(v);}
    if(Array.isArray(v))return Promise.all(v.map(walk));
    if(v&&typeof v==='object'){const out={};for(const [k,x] of Object.entries(v))out[k]=await walk(x);if(out.data&&typeof out.data==='string'&&/^https?:/.test(out.data)){out.src=out.data;out.data=null;}return out;}
    return v;
  }
  return walk(project);
}
