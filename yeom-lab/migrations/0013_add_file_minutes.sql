-- 0013_add_file_minutes.sql
-- 회의 자료용 전체 회의록 저장 컬럼과 문서 유형 컬럼.
ALTER TABLE files ADD COLUMN doc_type TEXT DEFAULT '';
ALTER TABLE files ADD COLUMN full_minutes TEXT;
