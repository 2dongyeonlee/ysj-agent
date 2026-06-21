// briefing.js - morning briefing, /brief, and contact briefing.

import { getMessagesSince, getRecentEngagements, getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const SEPARATOR = "━━━━━━━━━";

const BRIEF_SYSTEM = PERSONA_STYLE + "\n\n" + `summary 전체를 종합해 아래 양식만 채워라.
decision/followup 컬럼은 사용하지 않는다.
미결·결정·확인은 summary 본문에 명시된 것만 쓴다. 추론 금지.
각 항목은 핵심 1줄만 쓴다. summary 원문을 통째로 붙이지 않는다.
최근 만남은 사람 이름과 소속이 명시된 항목만 쓴다.
프로젝트 내용은 자세히 풀지 말고 안내 줄만 유지한다.

출력 양식:
🗞 브리핑 · {오늘}
━━━━━━━━━
🚨 결정·확인 필요
• [{사안일}] {항목}
🤝 최근 만남 · 상세 /info
• <b>{사람}</b> {소속} ({사안일})
📂 프로젝트 현황 → /project
━━━━━━━━━`;

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

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

function firstSentence(text) {
  const cleaned = stripHtml(text)
    .replace(/^📋\s*[^📌\n]+/u, "")
    .replace(/^📄\s*[^🎯\n]+/u, "")
    .replace(/📌\s*핵심\s*/g, "")
    .replace(/🎯\s*핵심:\s*/g, "")
    .replace(/^[•\-]\s*/g, "")
    .trim();
  const bullet = cleaned.match(/(?:^|\s)•\s*([^•\n]+)/);
  const source = bullet ? bullet[1].trim() : cleaned;
  const sentence = source.split(/(?<=[.!?。]|다\.|임\.|음\.)\s+/u)[0] || source;
  return sentence.length > 70 ? sentence.slice(0, 70).trim() + "…" : sentence;
}

function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const slash = source.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return Number(slash[1]) + "/" + Number(slash[2]);
  const dotted = source.match(/(\d{1,2})\.(\d{1,2})/);
  if (dotted) return Number(dotted[1]) + "/" + Number(dotted[2]);
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return Number(korean[1]) + "/" + Number(korean[2]);
  const d = new Date(row.created_at || Date.now());
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function sortByIssueDate(a, b) {
  const [am, ad] = issueDate(a).split("/").map(Number);
  const [bm, bd] = issueDate(b).split("/").map(Number);
  return (am * 100 + ad) - (bm * 100 + bd);
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
  const useful = (rows || []).filter(function (r) { return r.summary; }).sort(sortByIssueDate);
  if (!useful.length) return sendMessage(env, chatId, "현재 정리된 현안이 없습니다.");

  const digest = useful.map(function (r) {
    return "[" + issueDate(r) + "] " +
      (r.project ? "프로젝트:" + r.project + " " : "") +
      (r.category ? "대외정보:" + r.category + " " : "") +
      firstSentence(r.summary) +
      (r.people ? " / 인물:" + r.people : "");
  }).join("\n");

  const out = await callClaude(
    env,
    "오늘: " + todayText() + "\n구분선: " + SEPARATOR + "\n\nsummary 목록:\n" + digest,
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
