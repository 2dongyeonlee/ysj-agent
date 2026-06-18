CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  source_type TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  schedule TEXT DEFAULT '',
  category TEXT DEFAULT '',
  project TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  people TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_insights_chat ON insights(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_cat ON insights(category);
CREATE INDEX IF NOT EXISTS idx_insights_proj ON insights(project);
