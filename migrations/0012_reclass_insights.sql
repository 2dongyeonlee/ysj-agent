-- 0012_reclass_insights.sql
-- 파일 기반 insights를 파일명으로 올바른 프로젝트에 재배정. category는 공란(프로젝트분류).
-- UPDATE는 멱등 -> 재실행해도 안전.

-- prefix 또는 파일명 규칙으로 확인되는 프로젝트 자료
UPDATE insights SET project='용인 Pull-in', category=''
 WHERE source_ref IN (
   SELECT file_id FROM files
   WHERE filename LIKE '%용인%풀인%'
      OR filename LIKE '%용인국가일반산단%'
      OR filename LIKE '%용수전력%풀인%'
 );
UPDATE insights SET project='ADR', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE lower(filename) LIKE '%adr%');
UPDATE insights SET project='MDC', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE lower(filename) LIKE 'mdc%');
UPDATE insights SET project='넥서스', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE filename LIKE '넥서스%');
UPDATE insights SET project='방호시스템', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE filename LIKE '방호시스템%');
UPDATE insights SET project='서남권', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE filename LIKE '%서남권%');
UPDATE insights SET project='PjtA', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE lower(filename) LIKE '%pjt a%');

-- 날짜가 앞에 오는 기존 파일(규칙 이전) - 파일명에 키워드 포함으로 매칭
UPDATE insights SET project='성과관리', category=''
 WHERE source_ref IN (
   SELECT file_id FROM files
   WHERE filename LIKE '%성과관리%'
      OR (lower(filename) LIKE '%comm%' AND lower(filename) LIKE '%system%')
 );
UPDATE insights SET project='美FAB', category=''
 WHERE source_ref IN (SELECT file_id FROM files WHERE filename LIKE '%美%FAB%');
