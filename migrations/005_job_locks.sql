CREATE TABLE job_locks (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
