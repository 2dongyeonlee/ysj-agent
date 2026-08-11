-- 0018_add_item_no.sql
-- 회의록 내 Action Item 번호(완료 처리 버튼 매핑용).
ALTER TABLE action_items ADD COLUMN item_no INTEGER DEFAULT 0;
