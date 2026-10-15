CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
 output TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status,created_at);
CREATE TABLE IF NOT EXISTS clients (
 id TEXT PRIMARY KEY,version TEXT NOT NULL,capabilities TEXT NOT NULL,last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workers (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL,last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,dest_id TEXT NOT NULL,
 only_shopee INTEGER NOT NULL DEFAULT 1, block_external INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 0, UNIQUE(source_id,dest_id)
);
CREATE TABLE IF NOT EXISTS source_messages (
 msg_key TEXT PRIMARY KEY, source_id TEXT NOT NULL, msg_id TEXT NOT NULL,
 text TEXT NOT NULL, conversion_job_id TEXT,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
 id TEXT PRIMARY KEY,msg_key TEXT NOT NULL,dest_id TEXT NOT NULL,text TEXT NOT NULL,
 state TEXT NOT NULL,error TEXT,lease TEXT,lease_until INTEGER,remote_message_id TEXT,
 sent_at INTEGER,verified_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(msg_key,dest_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_state ON deliveries(state,created_at);
