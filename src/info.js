// info.js — external-affairs daily briefing. Categories: 정책/국회/BH/글로벌/언론PR.
// Triggered by /info or morning schedule. Source: all collected messages.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const INFO_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 수집 메시지에서 대외정보를 아래 고정 카테고리로 분류 요약. 염 사장 관점.\n" +
  "내용 없는 카테고리는 생략('특이사항 없음' 쓰지 말 것).\n" +
  "출력 형식:\n\n" +
  "📰 <b>대외정보 요약</b>\n\n" +
  "🏛 정책\n• {핵심}\n\n" +
  "🏛 국회\n• {핵심}\n\n" +
  "🏛 BH(대통령실)\n• {핵심}\n\n" +
  "🌐 글로벌\n• {핵심}\n\n" +
  "📰 언론·PR\n• {핵심}";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runInfoBriefing(env, chatId, days) {
  const rows = (await getInsightsSince(env, sinceDaysIso(days || 1), {}))
    .filter(function (r) { return r.category; });
  if (!rows || !rows.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리할 대외정보가 없습니다.");
    return;
  }
  const digest = rows.map(function (r) {
    return "[" + r.category + "] " + r.summary + (r.people ? " / " + r.people : "") + (r.schedule ? " / 일정: " + r.schedule : "");
  }).join("\n").slice(0, 12000);
  const out = await callClaude(env, "분류된 대외정보:\n" + digest, INFO_SYSTEM, MODEL_SMART, 2000);
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
