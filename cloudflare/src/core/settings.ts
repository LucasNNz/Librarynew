import type { Env } from "../types";
import { nowMs } from "./ids";

const FORBIDDEN=/(secret|token|password|credential|access[_-]?key|master[_-]?key|connection[_-]?code|cloudflare|account[_-]?id)/i;
const ALLOWED_PREFIXES=["supervisor_","worker_","collection_","operational_","source_","MATERIALIZER_","DIRECT_FILE_","GITHUB_PUBLIC_","fifo_","lease_","legacy_","preserve_","requeue_","skip_","fallback_"];
export function safeSettingKey(key:string){return !FORBIDDEN.test(key)&&ALLOWED_PREFIXES.some(p=>key.startsWith(p));}
export async function listSafeSettings(env:Env){const rows=await env.DB.prepare("SELECT key,value,updated_at FROM settings ORDER BY key").all<{key:string;value:string;updated_at:number}>();return (rows.results||[]).filter(r=>safeSettingKey(r.key));}
export async function updateSafeSetting(env:Env,key:string,value:unknown){if(!safeSettingKey(key))return {error:"SETTING_NOT_ALLOWED"};const text=typeof value==="string"?value:typeof value==="boolean"?(value?"true":"false"):String(value);const ts=nowMs();await env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,text,ts).run();return {key,value:text,updatedAt:ts};}
export async function bindingStatus(env:Env){let d1=false,r2=false,queue=false;try{await env.DB.prepare("SELECT 1").first();d1=true}catch{}try{await env.MEDIA.list({limit:1});r2=true}catch{}try{await env.MATERIALIZE_QUEUE.metrics();queue=true}catch{}return {architecture:"CLOUDFLARE_BINDINGS",d1,r2,queue,r2CredentialsStoredInD1:false};}
