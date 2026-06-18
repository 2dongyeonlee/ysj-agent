# 사장님봇 (pres-ai-bot) — 골격

KOH봇 검증 구조를 **모듈 분리**로 재구성. 단체방·1:1 DM·자료를 수집해 아래 기능을 제공한다.

## 기능 ↔ 모듈

### 동연 핵심 4기능
| 기능 | 모듈 | 원천 | 상태 |
|---|---|---|---|
| 1) 아침 브리핑 (일정/의사결정/주요내용) | `briefing.js` | messages | ✅ 동작 |
| 2) 자료 검색·전달 | `retrieve.js` | messages+files | ⏳ stub |
| 3) 만난 사람·내용 브리핑 | `briefing.js` runContactBriefing | engagements | ⏳ stub |
| 4) 만나기 전 브리핑 | `prep.js` | engagements | ⏳ stub |
| (공통) 메시지→접촉 자동추출 | `extract.js` | →engagements | ⏳ stub |

### KOH봇에서 가져온 범용기능
| 기능 | 모듈 | 상태 |
|---|---|---|
| 자료 요약 (파일 올리면) | `summarize.js` | ⏳ stub |
| 문서·이미지 텍스트 추출 | `docparse.js` | ⏳ stub |
| 질의응답 (물으면 답) | `qa.js` | ⏳ stub |
| /설정 (비서가 동작 조정: 시간·대상·말투) | `settings.js` | ✅ 동작 |
| 뉴스·웹검색 (Tavily) | `websearch.js` | ⏳ stub |
| 봇 추가/제거 감지 | `index.js` my_chat_member | ⏳ stub |

### 보류·제외 (결정 필요/목적 불일치)
- ⏸ 보류: RAG 임베딩(Vectorize), 메시지 포워딩 — 필요 시점에 추가
- ❌ 제외: 업무보고방 양식, 6R/8카테고리 분류 — KOH봇 팀실무용, 임원봇 부적합

## 구조

```
src/
  index.js     라우팅 (+ /설정, 봇감지)
  telegram.js  텔레그램 API          ← KOH봇 재사용
  claude.js    Anthropic API         ← KOH봇 재사용
  db.js        messages/files/contacts/engagements
  collect.js   메시지·자료 무음 수집
  ── 입력처리 ──
  docparse.js  문서·이미지 텍스트 추출   [stub]
  summarize.js 자료 요약               [stub]
  extract.js   메시지→접촉 추출        [stub]
  ── 출력/응답 ──
  briefing.js  기능1 아침 + 기능3 접촉  (아침 동작)
  retrieve.js  기능2 자료검색·전달      [stub]
  prep.js      기능4 만나기전          [stub]
  qa.js        일반 질의응답           [stub]
  ── 운영 ──
  settings.js  /설정 프롬프트 조정      [stub]
migrations/  0001_messages 0002_contacts 0003_engagements 0004_files
```

원칙: **한 파일 = 한 책임.** 기능 추가는 해당 파일만 Claude Code에 보낸다.

## 오늘 동작 범위
- **수집(collect) → 아침 브리핑(기능1)** 까지 실제 동작.
- 나머지는 **stub** — 입구(collect)는 전부 열려 있으니 출구만 채운다.

## 셋업 (새 Cloudflare 계정)
```bash
wrangler d1 create pres-ai-db          # database_id 복사
wrangler kv namespace create STATE     # id 복사
# wrangler.toml.template → wrangler.toml, <...> 채우기
for f in migrations/000*.sql; do wrangler d1 execute pres-ai-db --remote --file="$f"; done
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
# webhook: https://api.telegram.org/bot<토큰>/setWebhook?url=<워커URL>
```

## stub 채우는 순서 (권장)
1. **docparse + summarize** — 자료 요약(가장 자주 쓰고 KOH봇 코드 이식이라 빠름)
2. **qa** — 질의응답
3. **extract** — 접촉 자동축적 (기능3·4의 데이터)
4. **retrieve** — 자료 전달
5. **prep** — 만나기 전 (engagements 쌓인 뒤, 킬러기능)

## ⚠️ 주의
- KOH봇 리소스 ID 재사용 금지. 보안검토 전 실데이터 금지(더미만). 레포 private. R2는 백필 시(wrangler 주석).
