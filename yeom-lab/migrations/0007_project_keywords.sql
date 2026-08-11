-- 0007_project_keywords.sql
-- 프로젝트 키워드 분류 시스템.
-- (1) project_keywords: 키워드 -> 프로젝트 매핑. 코드 수정 없이 /addproject 로 추가 가능.
-- (2) insights 후속/완료 추적 컬럼.
-- (3) 초기 키워드 시드. keyword 는 소문자로 저장(매칭은 소문자끼리 비교).

CREATE TABLE IF NOT EXISTS project_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  keyword TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pkw_keyword ON project_keywords(keyword);

INSERT INTO project_keywords (project, keyword)
SELECT '넥서스', '넥서스' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '넥서스' AND keyword = '넥서스');
INSERT INTO project_keywords (project, keyword)
SELECT '넥서스', 'nexus' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '넥서스' AND keyword = 'nexus');
INSERT INTO project_keywords (project, keyword)
SELECT 'PjtA', 'pjta' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = 'PjtA' AND keyword = 'pjta');
INSERT INTO project_keywords (project, keyword)
SELECT 'PjtA', 'pjt a' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = 'PjtA' AND keyword = 'pjt a');
INSERT INTO project_keywords (project, keyword)
SELECT '서남권', '서남권' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '서남권' AND keyword = '서남권');
INSERT INTO project_keywords (project, keyword)
SELECT 'G건', 'g건' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = 'G건' AND keyword = 'g건');
INSERT INTO project_keywords (project, keyword)
SELECT '용인 Pull-in', '용인 pull-in' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '용인 Pull-in' AND keyword = '용인 pull-in');
INSERT INTO project_keywords (project, keyword)
SELECT '용인 Pull-in', 'pull in' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '용인 Pull-in' AND keyword = 'pull in');
INSERT INTO project_keywords (project, keyword)
SELECT '용인 Pull-in', 'pull-in' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '용인 Pull-in' AND keyword = 'pull-in');
INSERT INTO project_keywords (project, keyword)
SELECT '용인 Pull-in', '용인' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '용인 Pull-in' AND keyword = '용인');
INSERT INTO project_keywords (project, keyword)
SELECT '성과금', '성과금' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '성과금' AND keyword = '성과금');
INSERT INTO project_keywords (project, keyword)
SELECT 'TM PI', 'tm pi' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = 'TM PI' AND keyword = 'tm pi');
INSERT INTO project_keywords (project, keyword)
SELECT '그룹 광고', '그룹광고' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '그룹 광고' AND keyword = '그룹광고');
INSERT INTO project_keywords (project, keyword)
SELECT '그룹 광고', '그룹 광고' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = '그룹 광고' AND keyword = '그룹 광고');
INSERT INTO project_keywords (project, keyword)
SELECT 'PR 중요기사', 'pr중요기사' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project = 'PR 중요기사' AND keyword = 'pr중요기사');
