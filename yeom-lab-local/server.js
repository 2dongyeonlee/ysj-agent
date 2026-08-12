// server.js — yeom-lab 로컬 서버 진입점.
// Cloudflare Workers(fetch/scheduled) 대신 이 프로세스가 계속 떠 있으면서
// 텔레그램 장폴링 + node-cron 스케줄 + 상황판 HTTP 서버를 직접 돌린다.
// src/*.js 의 비즈니스 로직(분류·요약·브리핑·회의록)은 한 줄도 바뀌지 않았다 —
// env.DB/env.STATE/env.R2 를 로컬 파일로 구현한 어댑터만 새로 얹었다.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { createD1 } from "./src/adapters/db.js";
import { createKV } from "./src/adapters/kv.js";
import { createR2 } from "./src/adapters/r2.js";
import { runMigrations } from "./src/migrate.js";
import { startPolling } from "./src/telegramPoll.js";
import { startScheduler } from "./src/scheduler.js";
import { startDashboardServer } from "./src/dashboardServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "yeom-lab.db");
const R2_DIR = path.join(DATA_DIR, "r2");
const PORT = parseInt(process.env.DASHBOARD_PORT || "8787", 10);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ .env 에 ${name} 이(가) 없습니다. .env.example 을 복사해 채워주세요.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  requireEnv("TELEGRAM_BOT_TOKEN");
  requireEnv("ANTHROPIC_API_KEY");

  const rawDb = new Database(DB_PATH);
  runMigrations(rawDb);

  const env = {
    DB: createD1(DB_PATH),      // 마이그레이션에 쓴 것과 같은 파일을 별도 연결로 재사용
    STATE: createKV(rawDb),     // KV(env.STATE)는 같은 sqlite 파일의 kv_store 테이블
    R2: createR2(R2_DIR),
  };

  env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  env.ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
  env.TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
  env.BOT_USERNAME = process.env.BOT_USERNAME || "";
  env.BRIEFING_CHAT_ID = process.env.BRIEFING_CHAT_ID || "";
  env.BRIEFING_TARGET_ID = process.env.BRIEFING_TARGET_ID || "";
  env.ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
  env.ADMIN_USERNAMES = process.env.ADMIN_USERNAMES || "";
  // 비워두면 [📊 상황판] 버튼이 아예 안 뜬다(깨진 링크 방지). 외부에서 열고 싶으면
  // cloudflared tunnel 등으로 /dashboard 를 공개 HTTPS 로 노출한 뒤 그 주소를 넣는다.
  env.DASHBOARD_URL = process.env.DASHBOARD_URL || "";

  const dashboard = startDashboardServer(env, PORT);
  const scheduler = startScheduler(env);
  const polling = await startPolling(env);

  console.log("✅ yeom-lab-local 구동 중 — Ctrl+C 로 종료");

  const shutdown = () => {
    console.log("\n종료 중...");
    polling.stop();
    scheduler.stop();
    dashboard.close();
    rawDb.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("치명적 오류로 종료:", e && (e.stack || e.message));
  process.exit(1);
});
