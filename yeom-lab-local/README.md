# yeom-lab-local — 로컬 PC를 서버로 쓰는 버전

`yeom-lab`(Cloudflare Workers)과 **완전히 분리된 별도 실행본**입니다. 코드 로직(분류·요약·
브리핑·회의록 프롬프트)은 한 줄도 바뀌지 않았고, `env.DB`(D1) / `env.STATE`(KV) / `env.R2`
를 로컬 sqlite 파일·파일시스템으로 구현한 어댑터만 새로 얹었습니다. 텔레그램 연결은
**웹훅 대신 장폴링(long polling)** 을 씁니다 — 포트포워딩·터널·고정 IP 없이, PC가
인터넷에 연결만 되어 있으면 동작합니다.

## 사전 준비

- Node.js 18 이상 (`node -v` 로 확인)
- BotFather 로 만든 새 봇 토큰 (기존 yeom-lab/ysj-agent 봇과 겹치지 않는 별도 토큰 권장 —
  같은 토큰으로 웹훅과 폴링을 동시에 쓸 수 없습니다)
- **Ollama** (분류·요약·브리핑·회의록 생성용 무료 오픈소스 LLM을 이 PC에서 직접 돌립니다.
  API 키도, 인터넷 전송도 필요 없습니다 — 텍스트가 이 PC 밖으로 나가지 않아 Claude API보다
  보안 면에서 유리합니다):
  1. https://ollama.com 에서 설치 프로그램 다운로드 후 설치
  2. 설치 후 PowerShell/cmd 에서: `ollama pull qwen2.5:7b` (약 4.7GB 다운로드, 한 번만 하면 됨)
  3. Ollama는 설치 시 백그라운드 서비스로 자동 등록되어 PC 켜질 때 같이 켜집니다. 수동으로
     켜야 한다면 `ollama serve`
  - 참고: 7B 모델은 RAM 16GB 이상 권장(8GB에서도 동작은 하나 느릴 수 있음). PC 사양이
    낮으면 더 작은 모델(`qwen2.5:3b`)로 바꿔도 됩니다 — `.env`의 `OLLAMA_MODEL` 수정.
- **whisper.cpp** (선택 — 녹음→회의록 기능을 쓸 때만. 이것도 API 키 없이 이 PC에서 돕니다):
  1. https://github.com/ggml-org/whisper.cpp/releases 에서 `whisper-bin-x64.zip` 다운로드 후
     압축 해제 (NVIDIA 그래픽카드가 있으면 `whisper-cublas-*-bin-x64.zip` 이 훨씬 빠름)
  2. 모델 파일 다운로드 (브라우저로 그냥 접속하면 받아집니다):
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
     → 압축 푼 폴더에 같이 두기 (466MB. 더 정확하게 하려면 `ggml-large-v3-turbo.bin`,
     1.5GB, 대신 느림)
  3. ffmpeg 설치 (텔레그램 음성 형식 변환에 필요): https://www.gyan.dev/ffmpeg/builds/ 에서
     `ffmpeg-release-essentials.zip` → 압축 해제 후 `bin` 폴더를 시스템 PATH에 추가
  4. 봇과는 **별도 창**에서 계속 띄워둡니다:
     `whisper-server.exe -m ggml-small.bin -l ko --convert --port 8080`
  - 안 쓰실 거면 `.env` 의 `WHISPER_BASE_URL` 을 비우면 됩니다 (녹음 기능만 꺼지고
    나머지는 정상 동작).

## 설치 및 실행

```powershell
cd yeom-lab-local
npm install
Copy-Item .env.example .env
# .env 파일을 열어 TELEGRAM_BOT_TOKEN 을 채운다 (Ollama 관련 값은 기본값 그대로 둬도 됨)
npm start
```

정상 기동 시 아래처럼 뜹니다:

```
migrated: 0001_messages.sql
...
migrations: 18건 적용 완료
[dashboard] http://localhost:8787/dashboard
[scheduler] cron 3건 등록 완료 (2분 큐 / 평일 08:00 브리핑 / 매일 18:00 사전 알림, KST)
[telegram] long polling 시작 (offset=0)
✅ yeom-lab-local 구동 중 — Ctrl+C 로 종료
```

이제 봇에게 `/start` 를 보내면 바로 응답합니다. **이 터미널 창을 닫으면 봇도 멈춥니다** —
계속 켜두려면 아래 "항상 켜두기" 항목을 참고하세요.

## 기존 Cloudflare 버전과 다른 점

| 항목 | yeom-lab (Cloudflare) | yeom-lab-local |
|---|---|---|
| 텔레그램 연결 | 웹훅(외부에서 서버로 접속) | 장폴링(서버가 텔레그램에 계속 물어봄) — 외부 노출 불필요 |
| 텍스트 생성(분류·요약·브리핑·회의록) | Claude API (유료, 클라우드 전송) | 로컬 Ollama·Qwen2.5 (무료, PC 밖으로 전송 안 됨) |
| 녹음 받아쓰기(STT) | AssemblyAI / OpenAI (유료, 클라우드 전송) | 로컬 whisper.cpp (무료, PC 밖으로 전송 안 됨) |
| DB | D1 (Cloudflare) | 로컬 sqlite 파일 (`data/yeom-lab.db`) |
| KV | Cloudflare KV | 같은 sqlite 파일의 `kv_store` 테이블 |
| 파일 저장(녹음·문서 원본) | R2 | 로컬 폴더 (`data/r2/`) |
| 자동 실행 주기(Cron) | Cloudflare Cron Triggers | `node-cron` (같은 시각, KST로 직접 지정) |
| 상황판(Mini App) | Worker가 서빙 | 로컬 HTTP 서버(`http://localhost:8787/dashboard`) |
| 가동 조건 | 항상 켜져 있음(서버리스) | **이 PC가 켜져 있고 이 프로세스가 실행 중이어야 함** |

## 데이터는 어디 있나

- 메시지·인사이트·회의록 등 전부: `data/yeom-lab.db` (sqlite 파일 — 백업하려면 이 파일 하나만
  복사하면 됩니다)
- 녹음·문서 원본 파일: `data/r2/`
- 둘 다 `.gitignore` 처리되어 있어 GitHub에는 절대 올라가지 않습니다.

## [📊 상황판] 버튼을 텔레그램에서 쓰고 싶다면

텔레그램 정책상 인라인 버튼은 **공개 HTTPS 주소**만 열 수 있습니다. PC를 그대로 노출하지
않고 안전하게 터널링하려면:

```powershell
# cloudflared 설치 후 (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
cloudflared tunnel --url http://localhost:8787
```

출력되는 `https://xxxxx.trycloudflare.com` 주소 뒤에 `/dashboard` 를 붙여
`.env` 의 `DASHBOARD_URL` 에 넣고 재시작하면 버튼이 활성화됩니다. 비워두면 버튼 없이
`http://localhost:8787/dashboard` 로 로컬에서만 볼 수 있습니다.

## PC를 껐다 켜도 자동으로 다시 돌게 하려면 (선택)

**Windows — 작업 스케줄러**로 로그온 시 `npm start` 를 자동 실행하도록 등록하거나,
**PM2** 를 쓰면 더 간단합니다:

```powershell
npm install -g pm2
pm2 start server.js --name yeom-lab-local
pm2 save
pm2-startup install   # PC 재부팅 시 자동 시작 (안내에 따라 진행)
```

로그 확인: `pm2 logs yeom-lab-local` · 중지: `pm2 stop yeom-lab-local`

## 문제 해결

- **"getUpdates failed" 반복 출력** → `.env` 의 `TELEGRAM_BOT_TOKEN` 오타 확인, 인터넷 연결 확인.
- **그룹방에서 반응 없음** → 기존과 동일하게, BotFather `/setprivacy` → Disable → 봇을
  방에서 내보냈다 재초대해야 합니다.
- **"로컬 LLM(Ollama)에 연결할 수 없습니다" 응답만 옴** → Ollama가 안 켜져 있는 것입니다.
  PowerShell에서 `ollama serve` 실행 후 다시 시도하세요. `ollama list` 로 모델이 실제
  받아져 있는지도 확인해보세요(없으면 `ollama pull qwen2.5:7b-instruct`).
- **답변이 너무 느리거나 PC가 버벅임** → 모델이 PC 사양에 비해 큽니다. `.env`의
  `OLLAMA_MODEL` 을 `qwen2.5:3b` 로 바꾸고 `ollama pull qwen2.5:3b` 로 받은 뒤 재시작하세요.
- **녹음을 보내도 회의록이 안 옴** → whisper.cpp 서버가 떠 있는지 확인(별도 창에서
  `whisper-server.exe ...` 실행 중이어야 함). 콘솔에 `local whisper STT error` 가 찍히면
  메시지를 보고 판단하세요: `ECONNREFUSED` = 서버 꺼짐, `--convert` 관련 오류 = ffmpeg 미설치.
  10분 녹음은 CPU에서 5~15분 걸리니 조금 기다려야 합니다.
- **마이그레이션 오류로 시작이 안 됨** → `data/yeom-lab.db` 를 지우고(초기화됨) 다시
  `npm start` 하면 처음부터 다시 적용됩니다. 데이터가 있다면 먼저 백업하세요.
