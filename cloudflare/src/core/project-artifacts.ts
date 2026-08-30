import type { Env } from "../types";
import { createSignedCandidateUrl, createSignedFileUrl, createSignedPackageUrl, createSignedProjectFileUrl, createSignedProjectMediaUrl } from "./auth";

const clean=(value:unknown)=>String(value??"").trim();
const withMode=(url:string,mode:"preview"|"download")=>`${url}&mode=${mode}`;
const previewable=(mime:unknown)=>{const value=clean(mime).toLowerCase();return value.startsWith("image/")||value.startsWith("video/")||value.startsWith("audio/")||value.startsWith("text/")||value.includes("json")||value.includes("xml")||value==="application/pdf";};

export type ProjectArtifact = {
  id:string;
  source:"PROJECT_FILE"|"COLLECTED_CANDIDATE"|"APPROVED_ASSET"|"PROJECT_MEDIA"|"PACKAGE";
  stage:string;
  name:string;
  role?:string|null;
  item_id?:string|null;
  item_key?:string|null;
  status:string;
  mime_type?:string|null;
  size_bytes:number;
  created_at:number;
  updated_at?:number|null;
  preview_url?:string|null;
  download_url?:string|null;
  previewable:boolean;
  downloadable:boolean;
  metadata?:Record<string,unknown>;
};

export async function listProjectArtifacts(request:Request,env:Env,projectId:string,limit=500){
  const project=await env.DB.prepare("SELECT id,state_version FROM automatic_projects WHERE id=?").bind(projectId).first<Record<string,unknown>>();
  if(!project)return null;
  const safe=Math.max(1,Math.min(Number(limit||500),1000));
  const [files,candidates,approved,media,packages]=await Promise.all([
    env.DB.prepare("SELECT id,role,version,file_name,mime_type,size_bytes,content_hash,created_at FROM automatic_project_files WHERE project_id=? ORDER BY created_at DESC LIMIT ?").bind(projectId,safe).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,item_id,status,r2_key,mime_type,size_bytes,source_url,universe,subject,created_at,updated_at FROM v2_ingest_candidates WHERE project_id=? AND r2_key IS NOT NULL ORDER BY created_at DESC LIMIT ?").bind(projectId,safe).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT i.id AS item_row_id,i.item_key,i.status AS item_status,i.linked_asset_id,a.id AS asset_id,a.name,a.original_name,a.mime_type,a.size_bytes,a.created_at,a.updated_at
      FROM automatic_project_items i JOIN assets a ON a.id=i.linked_asset_id WHERE i.project_id=? AND i.linked_asset_id IS NOT NULL ORDER BY i.updated_at DESC LIMIT ?`).bind(projectId,safe).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,kind,status,name,mime_type,size_bytes,selected,slot_index,created_at,updated_at FROM v2_project_media WHERE project_id=? AND r2_key IS NOT NULL ORDER BY created_at DESC LIMIT ?").bind(projectId,safe).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,status,file_name,size_bytes,sha256,created_at,updated_at,r2_key FROM v2_download_packages WHERE project_id=? ORDER BY created_at DESC LIMIT ?").bind(projectId,Math.min(safe,100)).all<Record<string,unknown>>(),
  ]);

  const artifacts:ProjectArtifact[]=[];
  for(const row of files.results||[]){
    const signed=await createSignedProjectFileUrl(request,clean(row.id),env,900);
    const mime=clean(row.mime_type)||"application/octet-stream";
    artifacts.push({id:clean(row.id),source:"PROJECT_FILE",stage:clean(row.role)||"ANEXO",role:clean(row.role)||null,name:clean(row.file_name)||clean(row.id),status:"READY",mime_type:mime,size_bytes:Number(row.size_bytes||0),created_at:Number(row.created_at||0),preview_url:previewable(mime)?withMode(signed,"preview"):null,download_url:signed,previewable:previewable(mime),downloadable:true,metadata:{version:Number(row.version||1),content_hash:row.content_hash||null}});
  }
  for(const row of candidates.results||[]){
    const signed=await createSignedCandidateUrl(request,clean(row.id),env,900);
    const mime=clean(row.mime_type)||"application/octet-stream";
    const stored=Boolean(clean(row.r2_key));
    artifacts.push({id:clean(row.id),source:"COLLECTED_CANDIDATE",stage:"COLETA",item_id:clean(row.item_id)||null,name:clean(row.subject)||clean(row.source_url).split("/").pop()||clean(row.id),status:clean(row.status)||"UNKNOWN",mime_type:mime,size_bytes:Number(row.size_bytes||0),created_at:Number(row.created_at||0),updated_at:Number(row.updated_at||0)||null,preview_url:stored&&previewable(mime)?signed:null,download_url:stored?withMode(signed,"download"):null,previewable:stored&&previewable(mime),downloadable:stored,metadata:{source_url:row.source_url||null,universe:row.universe||null,subject:row.subject||null}});
  }
  for(const row of approved.results||[]){
    const assetId=clean(row.asset_id);if(!assetId)continue;
    const signed=await createSignedFileUrl(request,assetId,env,900);
    const mime=clean(row.mime_type)||"application/octet-stream";
    artifacts.push({id:assetId,source:"APPROVED_ASSET",stage:"APROVADO",item_id:clean(row.item_row_id)||null,item_key:clean(row.item_key)||null,name:clean(row.original_name)||clean(row.name)||assetId,status:clean(row.item_status)||"APPROVED",mime_type:mime,size_bytes:Number(row.size_bytes||0),created_at:Number(row.created_at||0),updated_at:Number(row.updated_at||0)||null,preview_url:previewable(mime)?signed:null,download_url:withMode(signed,"download"),previewable:previewable(mime),downloadable:true,metadata:{linked_asset_id:assetId}});
  }
  for(const row of media.results||[]){
    const signed=await createSignedProjectMediaUrl(request,clean(row.id),env,900);
    const mime=clean(row.mime_type)||"application/octet-stream";
    artifacts.push({id:clean(row.id),source:"PROJECT_MEDIA",stage:clean(row.kind)||"MEDIA",name:clean(row.name)||clean(row.id),status:clean(row.status)||"UNKNOWN",mime_type:mime,size_bytes:Number(row.size_bytes||0),created_at:Number(row.created_at||0),updated_at:Number(row.updated_at||0)||null,preview_url:previewable(mime)?signed:null,download_url:withMode(signed,"download"),previewable:previewable(mime),downloadable:true,metadata:{selected:Boolean(Number(row.selected||0)),slot_index:row.slot_index||null}});
  }
  for(const row of packages.results||[]){
    const ready=Boolean(clean(row.r2_key))&&["READY_FOR_DOWNLOAD","DOWNLOADED"].includes(clean(row.status));
    const signed=ready?await createSignedPackageUrl(request,clean(row.id),env,1800):null;
    artifacts.push({id:clean(row.id),source:"PACKAGE",stage:"EXPORT",name:clean(row.file_name)||`${clean(row.id)}.zip`,status:clean(row.status)||"UNKNOWN",mime_type:"application/zip",size_bytes:Number(row.size_bytes||0),created_at:Number(row.created_at||0),updated_at:Number(row.updated_at||0)||null,preview_url:null,download_url:signed,previewable:false,downloadable:Boolean(signed),metadata:{sha256:row.sha256||null}});
  }

  artifacts.sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  const counts=artifacts.reduce<Record<string,number>>((acc,item)=>{acc[item.source]=(acc[item.source]||0)+1;return acc;},{});
  const truncated=artifacts.length>safe;
  return {project_id:projectId,state_version:Number(project.state_version||1),total:artifacts.length,counts,truncated,artifacts:artifacts.slice(0,safe),visibility:"MCP_IMMEDIATE_AFTER_D1_COMMIT",links_ttl_seconds:900};
}
