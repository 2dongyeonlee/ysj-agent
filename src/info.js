// info.js — external-affairs briefing from structured insights. Categories: 정책/국회/BH/글로벌/언론PR.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const INFO_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래 구조화된 정보 항목을 카테고리별로 정리. 한 항목 1줄, 날짜·사람·안건 강조.\n" +
  "내용 없는 카테고리는 생략.\n" +
  "출력 형식:\n\n" +
  "📰 <b>대외정보 요약</b>\n\n" +
  "🏛 정책\n• 1줄\n\n" +
  "🏛 국회\n• 1줄\n\n" +
  "🏛 BH(대통령실)\n• 1줄\n\n" +
  "🌐 글로벌\n• 1줄\n\n" +
  "📰 언론·PR\n• 1줄";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runInfoBriefing(env, chatId, days) {
  // pull structured insights that have a category (대외정보)
  const rows = await getInsightsSince(env, sinceDaysIso(days || 1), {});
  const cat = (rows || []).filter(function (r) { return r.category; });
  if (!cat.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리할 대외정보가 없습니다.");
    return;
  }
  const digest = cat.map(function (r) {
    return "[" + r.category + "] " + r.summary + (r.people ? " (" + r.people + ")" : "");
  }).join("\n");
  const out = await callClaude(env, "정보 항목:\n" + digest, INFO_SYSTEM, MODEL_SMART, 1500);
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
