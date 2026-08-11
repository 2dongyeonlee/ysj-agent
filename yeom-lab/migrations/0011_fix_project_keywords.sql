-- 0011_fix_project_keywords.sql
-- (A) 오염 키워드 제거: "용인" 2자 단독 (ADR·서남권 자료 오매칭 유발)
DELETE FROM project_keywords WHERE project='용인 Pull-in' AND keyword='용인';

-- (B) 파일명 prefix + 고유명사 키워드 추가 (중복 무시)
INSERT INTO project_keywords (project, keyword) SELECT '용인 Pull-in', '용인풀인' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='용인 Pull-in' AND keyword='용인풀인');
INSERT INTO project_keywords (project, keyword) SELECT '용인 Pull-in', '용인 클러스터' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='용인 Pull-in' AND keyword='용인 클러스터');
INSERT INTO project_keywords (project, keyword) SELECT '용인 Pull-in', '용인 fab' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='용인 Pull-in' AND keyword='용인 fab');
INSERT INTO project_keywords (project, keyword) SELECT 'ADR', 'adr' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='ADR' AND keyword='adr');
INSERT INTO project_keywords (project, keyword) SELECT 'ADR', 'adr_pr' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='ADR' AND keyword='adr_pr');
INSERT INTO project_keywords (project, keyword) SELECT 'MDC', 'mdc' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='MDC' AND keyword='mdc');
INSERT INTO project_keywords (project, keyword) SELECT 'MDC', '국내향 저사양' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='MDC' AND keyword='국내향 저사양');
INSERT INTO project_keywords (project, keyword) SELECT '방호시스템', '방호시스템' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='방호시스템' AND keyword='방호시스템');
INSERT INTO project_keywords (project, keyword) SELECT '방호시스템', '미성위' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='방호시스템' AND keyword='미성위');
INSERT INTO project_keywords (project, keyword) SELECT '방호시스템', '미래성장위' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='방호시스템' AND keyword='미래성장위');
INSERT INTO project_keywords (project, keyword) SELECT '성과관리', '성과관리 system' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='성과관리' AND keyword='성과관리 system');
INSERT INTO project_keywords (project, keyword) SELECT '성과관리', 'comm 총괄성과관리' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='성과관리' AND keyword='comm 총괄성과관리');
INSERT INTO project_keywords (project, keyword) SELECT '美FAB', '美 fab' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='美FAB' AND keyword='美 fab');
INSERT INTO project_keywords (project, keyword) SELECT '美FAB', '미국 fab' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='美FAB' AND keyword='미국 fab');
INSERT INTO project_keywords (project, keyword) SELECT '美FAB', '인디애나 fab' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='美FAB' AND keyword='인디애나 fab');
INSERT INTO project_keywords (project, keyword) SELECT 'PjtA', 'pjta' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='PjtA' AND keyword='pjta');
INSERT INTO project_keywords (project, keyword) SELECT 'PjtA', 'pjt a' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='PjtA' AND keyword='pjt a');
INSERT INTO project_keywords (project, keyword) SELECT '넥서스', '환경단체' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='넥서스' AND keyword='환경단체');
INSERT INTO project_keywords (project, keyword) SELECT '넥서스', '환경재단' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='넥서스' AND keyword='환경재단');
INSERT INTO project_keywords (project, keyword) SELECT '넥서스', '숲과나눔' WHERE NOT EXISTS (SELECT 1 FROM project_keywords WHERE project='넥서스' AND keyword='숲과나눔');
