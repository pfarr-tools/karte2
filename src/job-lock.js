import crypto from 'node:crypto';

export function acquireJobLock({ database, name, now = new Date().toISOString(), ttlMs = 86_400_000 }) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
  const result = database.prepare(`
    INSERT INTO job_locks (name, token, acquired_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET token = excluded.token, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
    WHERE job_locks.expires_at <= excluded.acquired_at
  `).run(name, token, now, expiresAt);
  if (result.changes !== 1) return { acquired: false, release() {} };
  return {
    acquired: true,
    release() { database.prepare('DELETE FROM job_locks WHERE name = ? AND token = ?').run(name, token); },
  };
}
