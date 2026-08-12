// scheduler.js — Cloudflare Cron Triggers 대체. node-cron 은 KST(Asia/Seoul)를
// 그대로 지정할 수 있어 UTC 환산이 필요했던 wrangler.toml 의 cron 문자열보다 직관적이다.
// 대응표:
//   */2 * * * *        (동일)               → 큐 처리(2분마다)
//   0 23 * * sun-thu UTC = 평일 08:00 KST    → 아침 브리핑
//   0 9 * * * UTC      = 매일 18:00 KST      → 내일 일정 사전 브리핑

import cron from "node-cron";
import { runVoiceQueue, runTextMinutesQueue } from "./voice.js";
import { runDocumentSummaryQueue } from "./summarize.js";
import { runFileProcessQueue } from "./collect.js";
import { runInfoBriefing } from "./info.js";
import { runBriefAuto } from "./briefing.js";
import { runTomorrowAlert } from "./proactive.js";

const TZ = { timezone: "Asia/Seoul" };

export function startScheduler(env) {
  const jobs = [];

  // 2분마다 — 녹음 STT·회의록·문서 요약·파일 처리 큐. 빈 큐면 각 함수가 즉시 종료.
  jobs.push(cron.schedule("*/2 * * * *", async () => {
    await Promise.all([
      runVoiceQueue(env).catch((e) => console.error("voice queue error", (e && e.stack) || e)),
      runTextMinutesQueue(env).catch((e) => console.error("text minutes queue error", (e && e.stack) || e)),
      runDocumentSummaryQueue(env).catch((e) => console.error("doc summary queue error", (e && e.stack) || e)),
      runFileProcessQueue(env).catch((e) => console.error("file process queue error", (e && e.stack) || e)),
    ]);
  }, TZ));

  // 평일(월~금) KST 08:00 — 아침 브리핑.
  jobs.push(cron.schedule("0 8 * * 1-5", async () => {
    try {
      await runInfoBriefing(env, null, 2);
      await runBriefAuto(env);
    } catch (e) { console.error("morning briefing error", (e && e.stack) || e); }
  }, TZ));

  // 매일 KST 18:00 — 내일 일정 사전 브리핑 (내일 일정 없으면 침묵).
  jobs.push(cron.schedule("0 18 * * *", async () => {
    await runTomorrowAlert(env).catch((e) => console.error("tomorrow alert error", (e && e.stack) || e));
  }, TZ));

  console.log("[scheduler] cron 3건 등록 완료 (2분 큐 / 평일 08:00 브리핑 / 매일 18:00 사전 알림, KST)");
  return { stop() { jobs.forEach((j) => j.stop()); } };
}
