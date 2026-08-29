export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  MATERIALIZE_QUEUE: Queue<MaterializeJob>;
  CORVO_INTERNAL_KEY: string;
}

export type MaterializeJob = {
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
