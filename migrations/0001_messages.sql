-- 0001_messages.sql
-- 방에서 오가는 메시지를 모아 아침 브리핑의 원천으로 쓴다.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  sender TEXT DEFAULT '',
  text TEXT DEFAULT '',
  category TEXT DEFAULT '',          -- 브리핑 시 LLM이 분류(이슈/보고/대외컴)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_msg_chat_time ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(created_at DESC);
