# ysj-agent — 임원 전용 AI 비서봇

SK하이닉스 커뮤니케이션총괄 사장 전용 텔레그램 AI 비서. 단체방·1:1 DM·첨부자료를 자동 수집해 분류·요약·브리핑·질의응답을 제공한다. Cloudflare Workers 기반 서버리스 구조이며, 현재 **PoC 검증 단계**다.

---

## 📌 한눈에 보기 — 기능 현황

### ✅ 현재 동작하는 기능

| 기능 | 명령/트리거 | 설명 |
|---|---|---|
| 대외정보 브리핑 | `/info`, "대외정보 브리핑해줘" | 수집된 자료를 카테고리(정부·국회·BH·언론·학계·글로벌·경쟁사)별로 분류·요약 |
| 업무 브리핑 | `/brief`, "업무 요약해줘" | 확인필요 사항·Meeting·보고 안건·주요 정황 정리 |
| 아침 자동 브리핑 | 평일 08:00 (cron) | 지난 하루 자료를 출근 전 자동 푸시 |
| 통합 질의응답 | "○○ 어떻게 됐어", "넥서스 요약" | 전체 자료에서 키워드 검색 후 핵심·주요내용·Action Item 요약 |
| 회의록 자동생성 | 음성파일 업로드 | STT(AssemblyAI/OpenAI) → 배경·안건·주요내용·Action Item 구조화 |
| 문서·이미지 요약 | 파일 업로드 | PDF·docx·이미지(Vision) 텍스트 추출 후 요약 |
| 안건 분해 | 자동 | 1개 자료에 여러 안건이 있으면 안건별로 분리 저장 |
| 프로젝트 조회 | `/project [이름]` | 특정 프로젝트 관련 자료 타임라인 |
| 발신자 검색 | "○○○가 보낸 것" | 특정 인물이 공유한 자료 검색 |
| 자료 자동수집 | 자동(무음) | 단톡·DM의 텍스트·첨부를 조용히 적재 |

### 🔧 추가해야 하는 기능 (고도화)

| 항목 | 내용 | 우선도 |
|---|---|---|
| 사내 Tool 기반 재구축 | Agent Builder·LLM Notebook·GaiA 등 사내 인프라로 이전 | 높음 |
| 보안: 저장소 이전 | 현재 해외 Cloudflare D1 → 사내 플랫폼(정보 등급별 처리·저장) | 높음 |
| Agent 간 협업(A2A) | 임원 비서 Agent 등 타 Agent와 직접 통신해 자료 보고·일정 협의 자동화 | 중간 |
| 선제 알림 고도화 | 납기·회의 전 필요자료·히스토리 우선순위 판단해 선제 전달 | 중간 |
| RAG 임베딩 검색 | 현재 키워드(LIKE) 검색만 → 의미 기반 벡터 검색(Vectorize) 도입 | 중간 |
| 의사결정용 변환 | 단순 요약을 넘어 "판단에 쓰는 형태"로 가공 | 낮음 |

### ⚠️ 개선해야 하는 기능 (알려진 한계·간헐 오류)

| 증상 | 원인 | 대응 방향 |
|---|---|---|
| 방금 올린 자료가 즉시 검색 안 됨 | 첨부 추출·분류가 cron(2분) 처리 대기 | 처리 대기 안내 또는 즉시처리 큐 |
| 긴 자료 처리 시 응답 누락 | LLM 호출이 무거워 실행시간 초과(timeout) | 처리 단위 분할(배치 축소) |
| 분류 정확도 편차 | LLM 분류 + 키워드 보정의 충돌, JSON 파싱 간헐 실패 | 분류 규칙 정비, 폴백 강화 |
| 검색어 문구별 결과 편차 | 군더더기 단어가 검색 키워드 오염 | 불용어 제거 적용(개선됨) |
| 양식 일관성 | LLM 생성의 비결정성 | 핸들러별 양식 고정 + 검증 가드 |
| 첨부 추출 실패분 | 이미지·스캔 PDF 등 일부 추출 누락 | 실패분 재처리(/reindex) |

---

## 🗂 카테고리 분류 체계

수집된 대외정보는 다음 카테고리로 자동 분류된다.

`정부` · `국회` · `BH` · `언론` · `학계` · `글로벌` · `경쟁사` · `내부` · `기타`

- **내부·기타**는 대외정보 브리핑(`/info`)에서 제외 (내부 자료 노출 방지)
- **학계**는 교수·박사·전문가 자문 의견을 정부 동향과 분리

---

## ⚙️ 운영·관리 명령어

| 명령 | 기능 |
|---|---|
| `/help` | 도움말 |
| `/whoami` | 본인 chat_id·권한 확인 |
| `/info`, `/brief`, `/project` | 브리핑·조회 (일반 사용) |
| `/reindex` | 원문은 있으나 분류 안 된 자료 재분류 (관리자) |
| `/reclass` | 저장된 자료 카테고리 재판정 (관리자) |
| `/dedup` | 중복 자료 정리 (관리자) |
| `/resummary` | 빈약한 요약 재작성 (관리자) |
| `/addproject`, `/listproject`, `/delproject` | 프로젝트 키워드 관리 |
| `/addsub`, `/listsub`, `/delsub` | 프로젝트 하위 항목 관리 |

---

## 🏗 아키텍처

```text
텔레그램 ──webhook──▶ Cloudflare Workers (src/index.js 라우팅)
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
   수집(collect)      처리(parse)         응답(brief/qa)
       │                  │                  │
       ▼                  ▼                  ▼
  D1(messages/files/   docparse(Vision)   info/brief/
  insights)           STT(AssemblyAI)     summarize/project
       │              claude(분류·요약)
       ▼
  R2(원본파일) · KV(큐·세션)
```

### 스택

- **런타임**: Cloudflare Workers (서버리스)
- **저장**: D1(SQLite) · KV(큐·상태) · R2(원본파일)
- **AI**: Anthropic Claude (분류·요약·질의), AssemblyAI/OpenAI (STT), Tavily (웹검색)
- **스케줄**: Cron (아침 브리핑, 첨부 처리 큐)

### 모듈 구조 (`src/`)

```text
index.js      라우팅·명령 처리
collect.js    메시지·자료 무음 수집
docparse.js   문서·이미지 텍스트 추출 (Vision)
voice.js      음성→회의록 (STT)
insight.js    자료 분류·안건 분해
info.js       대외정보 브리핑 (/info)
briefing.js   업무·아침 브리핑 (/brief)
summarize.js  통합 질의응답·요약
project.js    프로젝트 조회 (/project)
people.js     인물·발신자 검색
db.js         D1 접근 (messages/files/insights/...)
telegram.js   텔레그램 API
claude.js     Anthropic API
```

---

## 🔐 보안 주의 (PoC 단계)

- **현재 저장소는 해외 Cloudflare 인프라** → 민감자료는 사내 이전 전까지 신중히 취급
- 토큰·API키는 `wrangler secret`으로 관리 (코드·설정파일에 평문 금지)
- 리소스 ID는 환경설정에만, 레포는 **private 유지**
- 정보 등급별 처리·저장 기준 확립이 고도화 핵심 과제

---

## 📋 셋업 (신규 환경)

```bash
wrangler d1 create ysj-db            # database_id 복사
wrangler kv namespace create STATE   # id 복사
# wrangler.toml.template → wrangler.toml, ID 채우기
for f in migrations/00*.sql; do wrangler d1 execute ysj-db --remote --file="$f"; done
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ASSEMBLYAI_API_KEY   # STT
wrangler secret put TAVILY_API_KEY       # 웹검색(선택)
wrangler deploy
# webhook 등록: https://api.telegram.org/bot<토큰>/setWebhook?url=<워커URL>
```
