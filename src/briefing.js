// briefing.js — 기능1(아침 브리핑) + 기능3(만난 사람 브리핑).

import { getMessagesSince, getRecentEngagements } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";

const MORNING_SYSTEM = `당신은 커뮤니케이션 총괄 사장의 아침 브리핑 비서입니다.
지난 하루 방·DM 대화를 읽고 사장이 출근길 30초에 파악하도록 정리하세요.

[일정] 오늘/이번주 예정된 일·약속·회의
[의사결정] 결정됐거나 사장 판단이 필요한 사항
[주요내용] 그 외 알아야 할 핵심 동향

규칙: 각 항목 한 줄, 누가 관련됐는지 포함. 추측·과장 금지, 대화에 나온 것만.
해당 없는 분류는 생략. 표·마크다운 기호 없이 텔레그램에서 읽기 좋은 줄글로.`;

const CONTACT_SYSTEM = `당신은 사장의 대외접촉 기록 비서입니다.
최근 사장이 만난 사람과 나눈 내용을 간결히 정리하세요.
형식: "· 이름(소속) — 주제: 핵심 한 줄". 과장 금지.`;

// 기능1: 아침 브리핑
export async function runMorningBriefing(env) {
  const chatIds = (env.BRIEFING_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!chatIds.length) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await getMessagesSince(env, chatIds, since);
  if (!rows.length) return;

  const digest = rows.map((r) => `[${r.sender}] ${r.text}`).join("\n");
  const summary = await callClaude(env, digest, MORNING_SYSTEM, MODEL_SMART, 1500);

  const today = new Date().toLocaleDateString("ko-KR");
  const target = env.BRIEFING_TARGET_ID || chatIds[0]; // 발송 대상 따로 지정 가능
  await sendMessage(env, target, `🌅 ${today} 아침 브리핑\n\n${summary}`);
}

// 기능3: 만난 사람·내용 브리핑 (요청 시 호출, 또는 아침브리핑에 합칠 수 있음)
export async function runContactBriefing(env, chatId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getRecentEngagements(env, since);
  if (!rows.length) {
    return sendMessage(env, chatId, `최근 ${days}일간 기록된 접촉이 없습니다.`);
  }
  const digest = rows.map((r) => `${r.met_at} ${r.name || "?"}(${r.org || ""}) ${r.topic} ${r.summary}`).join("\n");
  const summary = await callClaude(env, digest, CONTACT_SYSTEM, MODEL_SMART, 1200);
  await sendMessage(env, chatId, `🤝 최근 ${days}일 접촉\n\n${summary}`);
}
