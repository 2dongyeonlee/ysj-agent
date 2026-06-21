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

ALTER TABLE insights ADD COLUMN followup TEXT DEFAULT '';
ALTER TABLE insights ADD COLUMN done INTEGER DEFAULT 0;

INSERT INTO project_keywords (project, keyword) VALUES
  ('넥서스', '넥서스'),
  ('넥서스', 'nexus'),
  ('PjtA', 'pjta'),
  ('PjtA', 'pjt a'),
  ('서남권', '서남권'),
  ('G건', 'g건'),
  ('용인 Pull-in', '용인 pull-in'),
  ('용인 Pull-in', 'pull in'),
  ('용인 Pull-in', 'pull-in'),
  ('용인 Pull-in', '용인'),
  ('성과금', '성과금'),
  ('TM PI', 'tm pi'),
  ('그룹 광고', '그룹광고'),
  ('그룹 광고', '그룹 광고'),
  ('PR 중요기사', 'pr중요기사');
