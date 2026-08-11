-- 0004_files.sql
-- 방·DM에 올라온 자료(파일) 메타. 검색·전달(기능2)의 원천.
-- 원본 저장: 지금은 file_id, 나중에 r2_key(R2 백필 시).
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  file_id TEXT DEFAULT '',          -- 텔레그램 file_id (봇 전용)
  r2_key TEXT DEFAULT '',           -- R2 객체 키 (백필/영구보존 시)
  filename TEXT DEFAULT '',
  text TEXT DEFAULT '',             -- 추출 텍스트 (요약·검색용)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_files_chat ON files(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(filename);
