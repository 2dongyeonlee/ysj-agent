-- 0014_add_file_process_status.sql
-- files.process_status: 파일 접수 후 무거운 처리(텍스트 추출·insight) 진행 상태.
-- collect.js 가 접수 시 'pending' 으로 두고, runFileProcessQueue(Cron)가 완료 시 'done' 으로 갱신한다.
-- insight.js 의 재색인(reindex)이 process_status='done' 인 파일만 대상으로 삼는다.
--
-- ⚠️ 이미 라이브 DB 에 이 컬럼을 수동 추가(ALTER)한 적이 있으면 "duplicate column name"
--    오류가 난다. 그 경우 이 마이그레이션은 건너뛰면 된다(신규/복제 DB 에만 적용).
ALTER TABLE files ADD COLUMN process_status TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_files_status ON files(process_status);
