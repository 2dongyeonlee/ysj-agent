// adapters/kv.js — Cloudflare KV(env.STATE) 와 동일한 get/put/delete 모양을
// sqlite 한 테이블로 구현. expirationTtl(초)은 만료 시각(ms)으로 저장하고
// get 시점에 지연 만료(lazy expiry) 처리한다 — KV 의 TTL 동작과 동등하다.

export function createKV(raw) {
  raw.exec(
    "CREATE TABLE IF NOT EXISTS kv_store (" +
    "key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)"
  );
  const getStmt = raw.prepare("SELECT value, expires_at FROM kv_store WHERE key = ?");
  const delStmt = raw.prepare("DELETE FROM kv_store WHERE key = ?");
  const putStmt = raw.prepare(
    "INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
  );

  return {
    async get(key) {
      const row = getStmt.get(key);
      if (!row) return null;
      if (row.expires_at && row.expires_at < Date.now()) {
        delStmt.run(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, opts) {
      const ttlSec = opts && opts.expirationTtl;
      const expiresAt = ttlSec ? Date.now() + ttlSec * 1000 : null;
      putStmt.run(key, String(value), expiresAt);
    },
    async delete(key) {
      delStmt.run(key);
    },
  };
}
