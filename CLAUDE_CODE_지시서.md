# 사장님봇(pres-ai-bot) Claude Code 작업 지시서

> 이 지시서를 매 작업 시작 시 Claude Code에 함께 넣는다.
> KOH봇은 단일파일 2500줄을 여러 번 수정하며 매번 오류가 났다.
> 사장님봇은 **모듈 분리 골격 + 아래 불변 규칙**으로 그 실패를 구조적으로 막는다.

---

## 1. 불변 규칙 (모든 작업 공통) — 위반 시 즉시 중단

1. **한 번에 한 파일만 수정한다.** 여러 모듈을 동시에 건드리지 않는다.
2. **import/export 시그니처를 바꾸지 않는다.** 부득이 바꿔야 하면, 그 함수를 호출하는 **모든 곳을 같은 작업에서 함께 고치고** 변경 목록을 명시한다.
3. **`str_replace`만 사용한다.** `old_str`은 파일에서 그대로 복사해 붙인다. 기억·추측으로 쓰지 않는다.
4. **함수를 통째로 재작성하지 않는다.** 기존 분기·예외처리가 소실된다(KOH봇 단골 사고). 바꿔야 할 줄만 바꾼다.
5. **수정 후 반드시 `node --check <파일>`** 로 문법을 확인한다.
6. **모듈 경계를 지킨다.** SQL은 `db.js`에서만, 텔레그램 호출은 `telegram.js`에서만, LLM 호출은 `claude.js`에서만. 다른 모듈에서 직접 `fetch`/SQL 금지.
7. **배포 후 검증 체크리스트를 통과하기 전에는 다음 작업을 시작하지 않는다.**

---

## 2. Phase 0 — 골격 배치 (지금 첫 작업)

**목표:** 제공된 14개 모듈 + 마이그레이션 4개를 레포에 배치하고 **배포 가능 상태**를 확인한다. (기능 구현은 다음 Phase. 여기서는 골격이 "살아 있는지"만 본다.)

### 작업
1. 제공된 파일 트리 그대로 배치한다. **내용을 임의로 수정하지 않는다.**
   ```
   src/  index telegram claude db collect docparse summarize
         extract briefing retrieve prep qa websearch settings  (.js 14개)
   migrations/  0001_messages 0002_contacts 0003_engagements 0004_files (.sql)
   wrangler.toml.template, README.md
   ```
2. `wrangler.toml.template` → `wrangler.toml` 로 복사 후 `<...>` placeholder를 실제 값으로 채운다 (D1 id, KV id, 봇 username, 방 ID). **KOH봇 리소스 ID 재사용 금지.**
3. `node --check src/*.js` 전체 통과 확인.
4. 마이그레이션 4개 적용:
   `for f in migrations/000*.sql; do wrangler d1 execute pres-ai-db --remote --file="$f"; done`
5. 시크릿 등록: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`.
6. `wrangler deploy`.
7. webhook 등록: `https://api.telegram.org/bot<토큰>/setWebhook?url=<워커URL>`

### 검증 (전부 ✅ 여야 Phase 0 완료)
- [ ] `node --check` 14개 전부 OK
- [ ] `wrangler deploy` 성공
- [ ] 방에 텍스트 전송 → `SELECT * FROM messages ORDER BY id DESC LIMIT 3` 에 적재됨
- [ ] 방에 파일 전송 → `SELECT * FROM files ORDER BY id DESC LIMIT 3` 에 적재됨
- [ ] `/설정 시간 08:00` → "설정했습니다" 응답
- [ ] cron 또는 수동 트리거로 아침 브리핑 발송 확인

**이 6개가 통과하면 = 입구가 살아있고 골격이 배포된 상태.** 여기서 멈추고 다음 Phase로.

---

## 3. Phase 1+ — stub 채우는 순서 (한 번에 한 모듈)

```
docparse + summarize  (자료요약, KOH 코드 이식 → 빠름)
   → qa               (질의응답)
   → extract          (메시지→접촉 자동축적 = 기능3·4의 연료)
   → retrieve         (자료 검색·전달)
   → prep             (만나기 전 브리핑, 킬러기능 — 마지막)
```
각 모듈을 끝낼 때마다 배포·검증하고, 통과 후 다음으로.

---

## 4. stub 작업 지시 템플릿 (복붙해서 채워 쓴다)

```
[대상 파일] src/<모듈>.js — 이 파일만 수정
[목표] <한 줄>
[유지할 계약] 이 모듈이 export하는 함수 시그니처를 바꾸지 말 것:
   <함수명(인자)>
[쓸 다른 모듈] import만 하고 수정 금지:
   db.js: <함수>  /  claude.js: callClaude  /  telegram.js: sendMessage
[작업] str_replace로 TODO 주석 부분만 구현
[금지] 다른 파일 수정 · 시그니처 변경 · 함수 통째 재작성 · 모듈 밖 SQL/fetch
[완료 후] node --check src/<모듈>.js → wrangler deploy → 검증: <확인할 동작 1줄>
```

---

## 5. 절대 하지 말 것 (KOH봇 실패 재발 방지)

- ❌ 여러 모듈 한 번에 수정 — 어디서 깨졌는지 추적 불가
- ❌ 피처 브랜치 누적 — main에 직접, 작은 단위로 커밋(롤백 쉽게)
- ❌ 배포 없이 stub 여러 개 채우기 — 한꺼번에 터진다
- ❌ 함수 통째 재작성 — 기존 분기 소실
- ❌ `db.js`/`telegram.js`/`claude.js` 밖에서 직접 SQL·fetch — 모듈 경계 붕괴
- ❌ 골격 파일 내용 임의 변경(Phase 0) — 검증된 틀을 흔들지 말 것

---

## 6. 막혔을 때
- 에러가 나면 **추측해서 더 고치지 말고**, 에러 메시지 + 해당 파일을 그대로 보고한다.
- 배포 후 동작이 이상하면 `wrangler tail` 로그를 먼저 확인한다.
- 한 모듈에서 2번 이상 실패하면, 그 모듈 작업을 멈추고 원인부터 진단한다.
