// briefing.js — morning briefing + contact(면담 이력) briefing. Uses persona style.

import { getMessagesSince, getRecentEngagements, getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { buildDecisionText } from "./decision.js";

const BRIEF_SYNTH_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래 항목을 '프로젝트'와 '대외동향' 두 묶음으로 종합. 한 항목 1줄, 날짜·사람·안건 <b>굵게</b>.\n" +
  "해당 없는 묶음은 생략. 내용이 전혀 없으면 정확히 'NONE' 만 출력.\n" +
  "출력 형식:\n\n" +
  "📊 프로젝트\n• 1줄\n\n" +
  "📰 대외동향\n• 1줄";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const MORNING_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 지난 하루 대화를 읽고 염 사장이 출근길 30초에 파악하도록 정리. 한 항목 1줄.\n" +
  "날짜·사람·안건 <b>굵게</b>. 해당 없는 분류는 생략.\n" +
  "출력 형식:\n\n" +
  "🌅 <b>아침 브리핑</b>\n\n" +
  "📅 일정\n• 1줄\n\n" +
  "💡 의사결정\n• 1줄\n\n" +
  "📌 주요 내용\n• 1줄";

const CONTACT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 최근 염 사장이 만난 사람과 나눈 내용을 정리. 표·마크다운 금지.\n" +
  "각 줄: • <b>[날짜]</b> <u>이름(소속)</u> — 주제 핵심 한 줄.\n" +
  "출력 형식:\n\n" +
  "📇 <b>면담 이력</b>\n\n" +
  "• <b>[날짜]</b> <u>이름(소속)</u> — 핵심";

export async function runMorningBriefing(env, replyChatId) {
  const chatIds = (env.BRIEFING_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!chatIds.length) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await getMessagesSince(env, chatIds, since);
  if (!rows.length) return;
  const digest = rows.map((r) => `[${r.sender}] ${r.text}`).join("\n");
  const summary = await callClaude(env, "지난 하루 대화:\n" + digest, MORNING_SYSTEM, MODEL_SMART, 1500);
  const target = replyChatId || env.BRIEFING_TARGET_ID || chatIds[0];
  await sendMessage(env, target, summary);
}

// /brief — 3단 구조: 1) 보고요망  2) 의사결정 필요  3) 종합. (decision 흡수)
export async function runBrief(env, chatId) {
  const rows = await getInsightsSince(env, sinceDaysIso(14), {});
  const parts = [];

  // 1) 보고요망 — summary 에 "[보고요망]" 프리픽스가 붙은 항목
  const urgent = (rows || []).filter(function (r) {
    return String(r.summary || "").indexOf("[보고요망]") !== -1;
  });
  if (urgent.length) {
    const lines = urgent.map(function (r) {
      return "• " + String(r.summary || "").split("[보고요망] ").join("").split("[보고요망]").join("").trim();
    }).join("\n");
    parts.push("🚨 <b>보고요망</b>\n\n" + lines);
  }

  // 2) 의사결정 필요 — decision 로직 재사용
  const decision = await buildDecisionText(env, 14);
  if (decision) parts.push("💡 <b>의사결정 필요</b>\n\n" + decision);

  // 3) 종합 — 프로젝트/대외동향 종합
  if (rows && rows.length) {
    const digest = rows.map(function (r) {
      return (r.project ? "[" + r.project + "] " : (r.category ? "[" + r.category + "] " : "")) +
        (r.schedule ? r.schedule + " " : "") + r.summary + (r.people ? " (" + r.people + ")" : "");
    }).join("\n");
    const synth = await callClaude(env, "항목:\n" + digest, BRIEF_SYNTH_SYSTEM, MODEL_SMART, 1500);
    const t = String(synth || "").trim();
    if (t && t.toUpperCase() !== "NONE") parts.push("🗂 <b>종합</b>\n\n" + t);
  }

  if (!parts.length) return sendMessage(env, chatId, "현재 정리할 현안이 없습니다.");
  await sendMessage(env, chatId, "🗞 <b>브리핑</b>\n\n" + parts.join("\n\n"));
}

export async function runContactBriefing(env, chatId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getRecentEngagements(env, since);
  if (!rows.length) {
    return sendMessage(env, chatId, "최근 " + days + "일간 기록된 면담이 없습니다.");
  }
  const digest = rows.map((r) => `${r.met_at} ${r.name || "?"}(${r.org || ""}) ${r.topic} ${r.summary}`).join("\n");
  const summary = await callClaude(env, "면담 기록:\n" + digest, CONTACT_SYSTEM, MODEL_SMART, 1200);
  await sendMessage(env, chatId, summary);
}
