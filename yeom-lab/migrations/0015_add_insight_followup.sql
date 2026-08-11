-- 0015_add_insight_followup.sql
-- 운영 ysj-db 에 수동으로 추가돼 있던 insights 컬럼 보충.
-- getInsightsSince(/brief)가 SELECT 하므로 없으면 'no such column' SQLite 에러.
ALTER TABLE insights ADD COLUMN followup TEXT DEFAULT '';
ALTER TABLE insights ADD COLUMN done INTEGER DEFAULT 0;
