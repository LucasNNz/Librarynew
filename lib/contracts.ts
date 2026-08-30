export type AssetStatus = "APPROVED" | "PENDING" | "REJECTED" | string;

export type Asset = {
  id: string;
  name: string;
  universe: string;
  subject?: string | null;
  kind: string;
  status: AssetStatus;
  rawStatus?: string;
  tags: string[];
  uses: number;
  mimeType: string | null;
  sizeBytes?: number;
  r2Key: string;
  previewUrl?: string | null;
  qaStatus?: string;
  lastUsedAt?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogResponse = {
  items: Asset[];
  total: number;
  nextCursor?: string | null;
};

export type CatalogStats = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  universes: number;
  bytes: number;
  uses: number;
};

export type UniverseFacet = {
  name: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
};

export type Candidate = {
  id: string;
  operationId: string;
  sourceUrl: string;
  projectId?: string | null;
  itemId?: string | null;
  universe: string;
  subject: string;
  tags: string[];
  status: string;
  r2Key?: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  sizeBytes: number;
  failureReason?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type FastPushRequest = {
  urls: Array<{
    url: string;
    projectId?: string;
    itemId?: string;
    universe?: string;
    subject?: string;
    tags?: string[];
  }>;
};

export type FastPushResponse = {
  accepted: number;
  operationId: string;
  status: "QUEUED";
};

export type Operation = {
  id: string;
  type: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED";
  requested: number;
  succeeded: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
};

export type LibraryRequest = {
  id: string;
  project: string;
  raw_items: string;
  item_count: number;
  status: string;
  created_at: number;
};

export type Batch = {
  id: string;
  name: string;
  project?: string | null;
  status: string;
  manifest_text?: string | null;
  created_at: number;
  updated_at: number;
  assets?: Array<Record<string, unknown>>;
};

export type ImportRecord = {
  id: string;
  file_name: string;
  r2_key: string;
  size_bytes: number;
  status: string;
  created_at: number;
  manifest_text?: string | null;
  warnings: string;
};

export type AutomaticProject = {
  id: string;
  name: string;
  status: string;
  pipeline_status?: string | null;
  next_action?: string | null;
  project_domain?: string | null;
  queue_priority?: number;
  state_version?: number;
  total_items?: number;
  approved_count?: number;
  pending_count?: number;
  failed_count?: number;
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
  lifecycle_status?: "ACTIVE"|"COMPLETED"|"REJECTED"|string;
  mcp_locked?: number|boolean;
  rejected_at?: number | null;
  closed_reason?: string | null;
  workflow_updated_at?: number | null;
  workflow_tags?: Array<{tag:string;owner_id?:string|null;execution_id?:string|null;last_seen_at?:number|null;lease_expires_at?:number|null}>;
};

export type ProjectArtifact = {
  id:string;
  source:"PROJECT_FILE"|"COLLECTED_CANDIDATE"|"APPROVED_ASSET"|"PROJECT_MEDIA"|"PACKAGE"|string;
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

export type ProjectArtifactInventory = {
  project_id:string;
  state_version:number;
  total:number;
  counts:Record<string,number>;
  truncated:boolean;
  artifacts:ProjectArtifact[];
  visibility?:string;
  links_ttl_seconds?:number;
};

export type ProjectSlotSnapshot = {
  project: AutomaticProject;
  activeTags: Array<{tag:string;status:string;owner_id?:string|null;execution_id?:string|null;last_seen_at?:number|null;lease_expires_at?:number|null}>;
  slots: Array<{key:string;label:string;state:string;summary:string;progress:number;mcpOpen?:boolean;instruction?:string|null;openedBy?:string|null;openedAt?:number|null}>;
  progress: number;
  script?: Record<string,unknown>|null;
  referenceBrief?: Record<string,unknown>|null;
  thumbs: {count:number;selected:number;max:number};
  titles: {count:number;selected:number;max:number};
  items: Record<string,unknown>;
  production?: {reference_pools_total:number;production_scenes_total:number;production_slots_total:number;production_slots_resolved:number};
  candidates: Record<string,unknown>;
  package?: Record<string,unknown>|null;
  slotAccess?: Array<Record<string,unknown>>;
};

export type StorageAudit = {
  auditId?: string;
  status?: string;
  inventoryTruncated?: boolean;
  totalReferences?: number;
  distinctReferences?: number;
  r2Objects?: number;
  r2Bytes?: number;
  presentReferences?: number;
  missingReferences?: number;
  orphanObjects?: number;
  sharedKeys?: number;
  bySource?: Array<{source:string;references:number;distinctReferences:number;present:number;missing:number}>;
  missing?: Array<{key:string;references:Array<Record<string,unknown>>}>;
  orphan?: Array<{key:string;size:number}>;
  shared?: Array<{key:string;references:Array<Record<string,unknown>>}>;
};



export type PendingR2Match = {
  key: string;
  size: number;
  score: number;
  confidence: "EXACT"|"HIGH"|"MEDIUM"|"LOW";
  reasons: string[];
  autoRepairable: boolean;
};

export type PendingR2Reconcile = {
  pending: number;
  scannedObjects: number;
  inventoryTruncated: boolean;
  present: number;
  repairable: number;
  probable: number;
  unresolved: number;
  readOnly: boolean;
  items: Array<{
    assetId: string;
    name: string;
    universe: string;
    subject: string|null;
    currentR2Key: string;
    originalName: string;
    expectedBytes: number;
    state: "FOUND_CURRENT"|"FOUND_ALTERNATE"|"POSSIBLE_MATCH"|"NOT_FOUND";
    bestMatch: PendingR2Match|null;
    alternatives: PendingR2Match[];
  }>;
};

export type R2Explorer = {
  prefix: string;
  breadcrumbs: Array<{name:string;prefix:string}>;
  scannedObjects: number;
  totalBytes: number;
  referencedObjects: number;
  orphanObjects: number;
  directObjects: number;
  truncated: boolean;
  maxObjects: number;
  readOnly: boolean;
  folders: Array<{prefix:string;name:string;objects:number;bytes:number;referencedObjects:number;orphanObjects:number;newestUploaded:string|null}>;
  objects: Array<{key:string;size:number;uploaded:string;etag:string;referenced:boolean;references:Array<{source_table:string;source_id:string;r2_key:string}>}>;
};

export type DispatcherHealth = {
  ok: boolean;
  expiredLeases: number;
  queue: Array<Record<string,unknown>>;
  sessions: Array<Record<string,unknown>>;
  limits: Array<Record<string,unknown>>;
};

export type MaterializationStats = {
  candidateStates: Array<Record<string,unknown>>;
  operationStates: Array<Record<string,unknown>>;
  hostHealth: Record<string,unknown>;
};

export type R2CatalogSync = {
  ok: boolean;
  prefix: string;
  scannedR2: number;
  d1Assets: number;
  referencedR2: number;
  uncatalogedBefore: number;
  repaired: number;
  uncatalogedAfter: number;
  missingInR2: number;
  inventoryTruncated: boolean;
  repairLimitReached: boolean;
  repairedItems: Array<{assetId:string;key:string;mode:string}>;
  uncataloged: Array<{key:string;size:number}>;
  missing: Array<{id:string;r2_key:string;sha256:string|null}>;
  warnings: string[];
};
