-- 0003_engagements.sql
-- "누구를 언제 무슨 주제로 만났는지" 한 건 = 한 행.
CREATE TABLE IF NOT EXISTS engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  met_at TEXT,                       -- 접촉 일시
  topic TEXT DEFAULT '',             -- 주제/안건 (핵심 검색키)
  channel TEXT DEFAULT '',           -- 대면/통화/식사/행사
  summary TEXT DEFAULT '',
  followup TEXT DEFAULT '',           -- 결정·후속조치
  source_type TEXT DEFAULT '',       -- manual / file
  source_ref TEXT DEFAULT '',        -- 파일명 or 메시지ID
  raw_input TEXT DEFAULT '',          -- 원문(추출 재처리용 안전망)
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eng_topic ON engagements(topic);
CREATE INDEX IF NOT EXISTS idx_eng_contact ON engagements(contact_id, met_at DESC);
CREATE INDEX IF NOT EXISTS idx_eng_metat ON engagements(met_at DESC);
