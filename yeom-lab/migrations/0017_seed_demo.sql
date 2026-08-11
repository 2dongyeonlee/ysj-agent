-- 0017_seed_demo.sql
-- 목업 시연용 예시 데이터. 날짜는 적용 시점 기준(KST)으로 계산되며,
-- WHERE NOT EXISTS 가드로 재실행해도 중복 삽입되지 않는다.

-- 일정: 내일 2건 + 오늘 1건 (상황판 '금일 일정'과 18시 사전 알림 확인용)
INSERT INTO schedules (title, start_at, location, attendees)
SELECT '임원회의 (데모)', strftime('%Y-%m-%dT10:00', datetime('now','+9 hours','+1 day')), '본사 대회의실', '염성진, 권오혁'
WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE title='임원회의 (데모)');

INSERT INTO schedules (title, start_at, location, attendees)
SELECT '넥서스 협력사 미팅 (데모)', strftime('%Y-%m-%dT14:00', datetime('now','+9 hours','+1 day')), '외부', '환경재단'
WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE title='넥서스 협력사 미팅 (데모)');

INSERT INTO schedules (title, start_at, location, attendees)
SELECT '주간 보고 (데모)', strftime('%Y-%m-%dT16:00', datetime('now','+9 hours')), '집무실', ''
WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE title='주간 보고 (데모)');

-- 미완료 Action Item 4건 (상황판 '확인필요' 카운트·목록, [✅ Action Item만] 폴백용)
INSERT INTO action_items (content, owner, status)
SELECT '넥서스 MOU 초안 검토 후 의견 회신 (데모)', '이동연', 'open'
WHERE NOT EXISTS (SELECT 1 FROM action_items WHERE content LIKE '넥서스 MOU 초안%');

INSERT INTO action_items (content, owner, status)
SELECT 'O/I 보고자료 수정사항 반영 (데모)', '김선영', 'open'
WHERE NOT EXISTS (SELECT 1 FROM action_items WHERE content LIKE 'O/I 보고자료%');

INSERT INTO action_items (content, owner, status)
SELECT '서남권 현장 방문 일정 확정 (데모)', '', 'open'
WHERE NOT EXISTS (SELECT 1 FROM action_items WHERE content LIKE '서남권 현장 방문%');

INSERT INTO action_items (content, owner, status)
SELECT '홍보자료 배포 승인 요청 (데모)', '', 'open'
WHERE NOT EXISTS (SELECT 1 FROM action_items WHERE content LIKE '홍보자료 배포%');

-- 추적 이슈 1건 (상황판 '추적 이슈' 카운트)
INSERT INTO subscriptions (chat_id, keyword)
SELECT '5965410906', '중복상장'
WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE keyword='중복상장');

-- 프로젝트 신호등용 insights: 넥서스(최근 활동=주의), 서남권(열흘 전=정상)
INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender)
SELECT '5965410906', 'message', 'demo-1', '', '', '넥서스', '넥서스 환경재단 협력 MOU 초안 공유 — 검토 의견 요청 (데모)', '환경재단', '데모'
WHERE NOT EXISTS (SELECT 1 FROM insights WHERE source_ref='demo-1');

INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, created_at)
SELECT '5965410906', 'message', 'demo-2', '', '', '서남권', '서남권 추진 현황 정리 — 특이사항 없음 (데모)', '', '데모', datetime('now','-10 days')
WHERE NOT EXISTS (SELECT 1 FROM insights WHERE source_ref='demo-2');
