-- 0010_add_file_sender.sql
-- 파일 공유자(올린 사람) 저장용. /info·/brief 에서 file 자료 공유자 표시.
-- D1 원격 적용: wrangler d1 execute ysj-db --remote --file=migrations/0010_add_file_sender.sql
ALTER TABLE files ADD COLUMN sender TEXT DEFAULT '';
