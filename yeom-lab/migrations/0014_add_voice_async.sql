-- 0014_add_voice_async.sql
-- 운영 ysj-db 에는 수동으로 추가돼 있던 컬럼들(AssemblyAI 비동기 STT·파일 처리 상태).
-- 새 yeom-lab-db 초기화 시 필요.
ALTER TABLE files ADD COLUMN aai_id TEXT;
ALTER TABLE files ADD COLUMN aai_polls INTEGER DEFAULT 0;
ALTER TABLE files ADD COLUMN process_status TEXT DEFAULT '';
