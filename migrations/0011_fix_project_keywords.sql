-- 0011_fix_project_keywords.sql
-- (A) 오염 키워드 제거: "용인" 2자 단독 (ADR·서남권 자료 오매칭 유발)
DELETE FROM project_keywords WHERE project='용인 Pull-in' AND keyword='용인';

-- (B) 파일명 prefix + 고유명사 키워드 추가 (소문자 저장, 중복 무시)
INSERT INTO project_keywords (project, keyword)
SELECT v.project, v.keyword FROM (
  SELECT '용인 Pull-in' AS project, '용인풀인' AS keyword
  UNION ALL SELECT '용인 Pull-in','용인 클러스터'
  UNION ALL SELECT '용인 Pull-in','용인 fab'
  UNION ALL SELECT 'ADR','adr'
  UNION ALL SELECT 'ADR','adr_pr'
  UNION ALL SELECT 'MDC','mdc'
  UNION ALL SELECT 'MDC','국내향 저사양'
  UNION ALL SELECT '방호시스템','방호시스템'
  UNION ALL SELECT '방호시스템','미성위'
  UNION ALL SELECT '방호시스템','미래성장위'
  UNION ALL SELECT '성과관리','성과관리 system'
  UNION ALL SELECT '성과관리','comm 총괄성과관리'
  UNION ALL SELECT '美FAB','美 fab'
  UNION ALL SELECT '美FAB','미국 fab'
  UNION ALL SELECT '美FAB','인디애나 fab'
  UNION ALL SELECT 'PjtA','pjta'
  UNION ALL SELECT 'PjtA','pjt a'
  UNION ALL SELECT '넥서스','환경단체'
  UNION ALL SELECT '넥서스','환경재단'
  UNION ALL SELECT '넥서스','숲과나눔'
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM project_keywords p
  WHERE p.project = v.project AND p.keyword = v.keyword
);
