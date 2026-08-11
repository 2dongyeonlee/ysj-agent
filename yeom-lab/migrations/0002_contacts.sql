-- 0002_contacts.sql
-- 사장님이 만나는 외부 인물 마스터 (접촉이력 CRM 의 한 축).
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  org TEXT DEFAULT '',               -- 소속
  title TEXT DEFAULT '',             -- 직책
  rel_type TEXT DEFAULT '',          -- 기자/정부/국회/글로벌/사내임원
  aliases TEXT DEFAULT '',           -- 콤마구분 별칭(김기자,김차장)
  note TEXT DEFAULT '',
  last_met_at TEXT DEFAULT '',       -- 최근 접촉(관계공백 탐지용)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org);
