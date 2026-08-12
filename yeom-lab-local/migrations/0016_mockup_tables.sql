-- 0016_mockup_tables.sql
-- 목업②③용: 일정 / Action Item / 이슈 구독 테이블.
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  start_at TEXT DEFAULT '',          -- KST 'YYYY-MM-DDTHH:MM'
  location TEXT DEFAULT '',
  attendees TEXT DEFAULT '',
  source_msg_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sched_start ON schedules(start_at);

CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  minutes_id INTEGER DEFAULT 0,
  content TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_status ON action_items(status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT DEFAULT '',
  keyword TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
