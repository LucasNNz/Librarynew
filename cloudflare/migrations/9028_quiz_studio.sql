-- Additive only. No changes to existing Library tables.
CREATE TABLE IF NOT EXISTS quiz_documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT,revision INTEGER NOT NULL DEFAULT 0,snapshot_key TEXT,summary_json TEXT NOT NULL DEFAULT '{}',updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_jobs(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,request_json TEXT NOT NULL,status TEXT NOT NULL,expected_revision INTEGER,client_id TEXT NOT NULL,owner TEXT,lease_until INTEGER,result_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(document_id,client_id));
CREATE INDEX IF NOT EXISTS quiz_jobs_queue ON quiz_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS quiz_jobs_document ON quiz_jobs(document_id,status);
CREATE TABLE IF NOT EXISTS quiz_media(id TEXT PRIMARY KEY,r2_key TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_uploads(id TEXT PRIMARY KEY,r2_key TEXT NOT NULL,upload_id TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_executors(id TEXT PRIMARY KEY,seen_at INTEGER NOT NULL);
