// briefing.js - morning briefing, /brief, and contact briefing.

import { getMessagesSince, getRecentEngagements, getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const BRIEF_SYSTEM = PERSONA_STYLE + "\n\n" + `아래 summary 전체를 종합해 2섹션만 채워라.
decision/followup 컬럼은 보지 말고, summary 본문에 명시된 결정·확인 사항만 사용한다.
추론으로 미결·결정사항을 만들지 않는다. 없는 내용은 쓰지 않는다.
최근 만남은 사람 이름과 소속이 명시된 항목만 쓴다.
각 항목은 짧게 1줄.

출력 양식:
🗞 브리핑 · {날짜}
═══
🚨 결정·확인 필요
• [날짜] 명시된 결정·확인 사항
🤝 최근 만남
• <b>이름</b> 소속·직함 (날짜)
═══
ℹ️ 상세 /info · /project`;

const MORNING_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 지난 하루 대화를 읽고 사장님이 출근길 30초에 파악하도록 정리. 각 항목 1줄.\n" +
  "날짜·사람·안건 <b>굵게</b>. 해당 없는 분류는 생략.\n" +
  "출력 형식:\n\n" +
  "🗞 <b>아침 브리핑</b>\n\n" +
  "📅 일정\n• 1줄\n\n" +
  "🚨 의사결정\n• 1줄\n\n" +
  "📌 주요 내용\n• 1줄";

const CONTACT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 최근 사장님이 만난 사람과 나눈 내용을 정리. 미사여구 금지.\n" +
  "각 줄: • <b>[날짜]</b> <u>이름(소속)</u> — 주제 핵심 한 줄\n" +
  "출력 형식:\n\n" +
  "🤝 <b>면담 이력</b>\n\n" +
  "• <b>[날짜]</b> <u>이름(소속)</u> — 핵심";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayText() {
  const d = new Date();
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function rowDate(row) {
  const schedule = String(row.schedule || "").match(/\d{1,2}\/\d{1,2}/);
  if (schedule) return schedule[0];
  const d = new Date(row.created_at || Date.now());
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

async function sendLongMessage(env, chatId, text) {
  const limit = 3500;
  const parts = [];
  let rest = String(text || "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < 1000) cut = rest.lastIndexOf("\n", limit);
    if (cut < 1000) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  for (const part of parts) await sendMessage(env, chatId, part);
}

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

export async function runBrief(env, chatId) {
  const rows = await getInsightsSince(env, sinceDaysIso(14), {});
  const useful = (rows || []).filter(function (r) { return r.summary; });
  if (!useful.length) return sendMessage(env, chatId, "현재 정리된 현안이 없습니다.");

  const digest = useful.map(function (r) {
    return "[" + rowDate(r) + "] " +
      (r.project ? "프로젝트:" + r.project + " " : "") +
      (r.category ? "대외정보:" + r.category + " " : "") +
      stripHtml(r.summary) +
      (r.people ? " / 인물:" + r.people : "");
  }).join("\n");

  const out = await callClaude(
    env,
    "오늘 날짜: " + todayText() + "\n\nsummary 목록:\n" + digest,
    BRIEF_SYSTEM,
    MODEL_SMART,
    1800
  );
  await sendLongMessage(env, chatId, out);
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
