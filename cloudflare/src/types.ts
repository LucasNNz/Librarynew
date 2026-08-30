export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  MATERIALIZE_QUEUE: Queue<CorvoQueueJob>;
  CORVO_INTERNAL_KEY: string;
  CORVO_APP_KEY: string;
  CORVO_SIGNING_KEY: string;
  CLOUDFLARE_CONTROL_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CORVO_WORKER_NAME?: string;
  CORVO_D1_DATABASE_ID?: string;
  CORVO_R2_BUCKET_NAME?: string;
  CORVO_QUEUE_NAME?: string;
  CORVO_DLQ_NAME?: string;
  CORVO_APP_ORIGIN?: string;
  IMAGES?: any; // Optional Cloudflare Images binding used only for technical JPG/PNG/WEBP conversion during final Forma export.
}

export type MaterializeJob = {
  kind?: "MATERIALIZE_URL";
  operationId: string;
  candidateId: string;
  url: string;
  projectId?: string;
  itemId?: string;
  universe?: string;
  subject?: string;
  tags?: string[];
};

export type FastPushItem = {
  url?: string;
  projectId?: string;
  itemId?: string;
  universe?: string;
  subject?: string;
  tags?: string[];
};

export type FastPushBody = { urls?: FastPushItem[] };

export type LegacyAssetRow = {
  id: string;
  name: string;
  universe: string;
  kind: string;
  status: string;
  tags: string;
  r2_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  use_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
  subject: string | null;
  previous_status: string | null;
  project_origin: string | null;
  script_reference: string | null;
  visual_reference: string | null;
  source_url: string | null;
  operational_note: string | null;
  qa_status: string;
  sha256: string | null;
  semantic_family: string | null;
};

export type FastApproveJob = {
  kind: "FAST_APPROVE_PROJECT_ITEMS";
  operationId: string;
  projectId: string;
  approvals: Array<{ itemId?: string; targetFile?: string; candidateId: string; note?: string }>;
};

export type SupervisorDecisionsJob = {
  kind: "SUPERVISOR_DECISIONS";
  operationId: string;
  projectId: string;
  decisions: Array<{ itemId: string; status: string; observation?: string }>;
};


export type QaDecisionsJob = {
  kind: "QA_DECISIONS";
  operationId: string;
  decisions: Array<{ candidateId: string; decision: "APPROVE" | "REJECT"; observation?: string }>;
};

export type PackageJob = {
  kind: "GENERATE_PACKAGE";
  operationId: string;
  packageId: string;
  projectId: string;
};

export type CollectionJob = {
  kind: "COLLECTION_TICK";
  operationId: string;
  batchId: string;
  rounds: number;
};

export type AssetExportJob = {
  kind: "EXPORT_ASSETS";
  operationId: string;
  exportId: string;
};

export type ImportZipJob = {
  kind: "PROCESS_IMPORT_ZIP";
  importId: string;
};

export type CorvoQueueJob = MaterializeJob | FastApproveJob | SupervisorDecisionsJob | QaDecisionsJob | PackageJob | CollectionJob | AssetExportJob | ImportZipJob;
