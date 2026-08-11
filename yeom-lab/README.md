# yeom-lab — ysj-agent 실험용 복제본

운영 라인(ysj-agent Worker · ysj-db · 기존 봇)과 **완전 분리**된 실험용 Worker.
원본 대비 기능 변경은 **브리핑 인라인 버튼 + callback_query 분기** 하나뿐이다.

## 원본과의 차이
- `wrangler.toml`: name=yeom-lab, 새 D1/KV/R2, `[vars]` 직접 정의 (테스트 방 ID)
- `src/telegram.js`: `sendMessage(..., extra)` reply_markup 지원, `answerCallbackQuery` 추가
- `src/briefing.js`: `runBrief` 출력 마지막에 2×2 인라인 버튼, `extraDays` 옵션(지난주)
- `src/index.js`: webhook에 `callback_query` 분기(`handleCallback`)
- `migrations/0014_add_voice_async.sql`: 운영 DB에 수동 추가돼 있던 컬럼 보충

## 셋업 A — GitHub Actions (패드/폰에서 가능, 권장)

로컬 명령 없이 저장소의 `yeom-lab setup` 워크플로우(Actions 탭)가 전부 수행한다:
D1/KV/R2 생성 → id 치환 → 마이그레이션 → 배포 → Worker 시크릿 → setWebhook.

사전 준비 (GitHub 웹 → Settings → Secrets and variables → Actions):
- `YEOMLAB_TELEGRAM_BOT_TOKEN` — BotFather 로 만든 **새 봇** 토큰
- `ANTHROPIC_API_KEY` / `TAVILY_API_KEY` / `ASSEMBLYAI_API_KEY` — 있는 것만 (없으면 해당 기능만 비활성)
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 는 기존 deploy 용으로 이미 있음

실행 시 입력: 새 봇 username, 테스트 방 chat_id (기본값: 운영자 DM).
봇 토큰 Secret 이 없으면 시크릿·webhook 단계만 건너뛰고 나머지는 진행된다(재실행 가능).

## 셋업 B — 로컬 (Windows PowerShell, 이 폴더 안에서)

```powershell
# 0) 이 폴더를 C:\Users\pc\Documents\6r-ai-bot\yeom-lab 로 복사한 뒤 그 안에서 실행
cd C:\Users\pc\Documents\6r-ai-bot\yeom-lab

# 1) 리소스 생성 → 출력된 id 를 wrangler.toml 의 REPLACE_ 자리에 채운다
npx wrangler d1 create yeom-lab-db          # database_id
npx wrangler kv namespace create yeom-lab-kv # kv id
npx wrangler r2 bucket create yeom-lab-files

# 2) 스키마 초기화 (migrations 전체 적용)
Get-ChildItem .\migrations\*.sql | Sort-Object Name | ForEach-Object {
  npx wrangler d1 execute yeom-lab-db --remote --file $_.FullName
}

# 3) wrangler.toml [vars] 의 REPLACE_ 값을 테스트 방 ID·새 봇 이름으로 교체

# 4) 시크릿 등록 (⚠️ 새 봇 토큰! 기존 봇 토큰 금지)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put ASSEMBLYAI_API_KEY   # 녹음 STT 사용 시

# 5) 배포 → 출력된 Worker URL 확인
npx wrangler deploy

# 6) 새 봇 토큰으로 webhook 연결 (브라우저 또는 curl)
#    https://api.telegram.org/bot<새토큰>/setWebhook?url=https://yeom-lab.<subdomain>.workers.dev
#    (이 코드는 경로 구분 없이 POST 전체를 webhook 으로 받으므로 루트 URL 이면 된다)

# 7) 검증: 운영 방 ID 잔존 0건이어야 함
Select-String -Path .\wrangler.toml,.\src\*.js -Pattern "5544783640|5383429876"
```

## 인라인 버튼
브리핑(`/brief`, 자동 브리핑) 마지막 메시지에 표시:

| 버튼 | callback_data | 동작 |
|---|---|---|
| 📋 상세보기 | `detail` | `runBrief` 재호출 (기존 로직 그대로) |
| 📅 지난주 | `lastweek` | `runBrief(…, 7)` — 조회 범위 −7일 확장 |
| 📌 이슈 추적 | `track` | "준비 중입니다" 스텁 |
| ✉️ 메일로 | `mail` | "준비 중입니다" 스텁 |

모든 분기에서 `answerCallbackQuery` 를 먼저 호출해 스피너를 해제한다.
