// briefing.js - morning briefing, /brief, and contact briefing.

import { getMessagesSince, getRecentEngagements, getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const SEPARATOR = "━━━━━━━━━";
const INFO_CATEGORIES = ["정부", "국회", "BH", "글로벌", "언론"];
const INTERNAL_PERSON_RE = /염성진|윤풍영|SK그룹 의장|커뮤니케이션위원장|SK그룹|SKHY|SKALA|Hy-Five|담당 사장|TF 총괄|Steering Committee|협의회|CR팀장|미래전략/;
const EXTERNAL_AFFIL_RE = /장관|차관|고용노동부|산업통상자원부|산업부|과기부|정부|국회|의원|BH|대통령|총리|엔비디아|CEO|해외|글로벌/;

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

function oneLine(text, max = 70) {
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
  return sentence.length > max ? sentence.slice(0, max).trim() + "…" : sentence;
}

function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const iso = source.match(/20\d{2}[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})/);
  if (iso) return Number(iso[1]) + "/" + Number(iso[2]);
  const slash = source.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return Number(slash[1]) + "/" + Number(slash[2]);
  const dotted = source.match(/(\d{1,2})\.(\d{1,2})/);
  if (dotted) return Number(dotted[1]) + "/" + Number(dotted[2]);
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return Number(korean[1]) + "/" + Number(korean[2]);
  const d = new Date(row.created_at || Date.now());
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function issueScore(row) {
  const [m, d] = issueDate(row).split("/").map(Number);
  return m * 100 + d;
}

function sortByImminence(a, b) {
  const now = new Date();
  const today = (now.getMonth() + 1) * 100 + now.getDate();
  return Math.abs(issueScore(a) - today) - Math.abs(issueScore(b) - today);
}

function textOf(row) {
  return String(row.schedule || "") + " " + String(row.summary || "") + " " + String(row.people || "");
}

function isOI(row) {
  return /O\/I|커뮤니케이션총괄 O\/I|사내 보고|운영계획|추진 현황 보고|TF 보고/.test(textOf(row));
}

function isMeetingRow(row) {
  if (!INFO_CATEGORIES.includes(row.category)) return false;
  if (isOI(row)) return false;
  if (!/면담|간담회|환담/.test(textOf(row))) return false;
  return externalPeople(row).length > 0;
}

function externalPeople(row) {
  const chunks = String(row.people || "")
    .split(/[,/·\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  const out = [];
  for (const chunk of chunks) {
    if (INTERNAL_PERSON_RE.test(chunk)) continue;
    if (!EXTERNAL_AFFIL_RE.test(chunk)) continue;
    const name = (chunk.match(/^([가-힣A-Za-z]+(?:\s+[A-Za-z]+)?)/) || [null, chunk])[1];
    if (name && out.indexOf(chunk) === -1) out.push(chunk);
  }
  return out;
}

function isDecisionRow(row) {
  if (isOI(row)) return false;
  return /보고요망|확정|결정|승인|낙점|출범|오픈 예정|예정|확인 필요/.test(textOf(row));
}

function isReportRow(row) {
  const text = textOf(row);
  if (isOI(row)) return true;
  return /발표|보고|준비|토킹포인트|연설|간담회|행사/.test(text) && /사장|염성진|의장|위원장|운영계획|토킹포인트|발표|연설/.test(text);
}

function reportTag(row) {
  return isOI(row) ? "[사내]" : "[외부]";
}

function reportTitle(row) {
  const text = stripHtml(row.summary);
  const title = text.match(/📋\s*([^\n]+)/) || text.match(/([^.\n]*O\/I[^.\n]*)/);
  return title ? title[1].trim() : oneLine(row.summary, 60);
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
  const useful = (rows || []).filter(function (r) { return r.summary; }).sort(sortByImminence);
  if (!useful.length) return sendMessage(env, chatId, "현재 정리된 현안이 없습니다.");

  const decisions = useful.filter(isDecisionRow).slice(0, 5);
  const meetings = useful.filter(isMeetingRow).slice(0, 5);
  const reports = useful.filter(isReportRow).slice(0, 5);

  const lines = ["🗞 브리핑 · " + todayText(), SEPARATOR];
  lines.push("🚨 결정·확인 필요");
  if (decisions.length) {
    for (const row of decisions) lines.push("• [" + issueDate(row) + "] " + oneLine(row.summary));
  } else {
    lines.push("• 임박한 결정·확인 필요 건 없음");
  }

  lines.push("🤝 만남 (외부)");
  if (meetings.length) {
    for (const row of meetings) {
      const people = externalPeople(row).map(function (p) { return "<b>" + p + "</b>"; }).join(" · ");
      lines.push("• " + people + " (" + issueDate(row) + ")");
    }
  } else {
    lines.push("• 임박한 외부 만남 없음");
  }

  lines.push("📋 보고 건");
  if (reports.length) {
    for (const row of reports) lines.push("• " + reportTag(row) + " " + reportTitle(row) + " (" + issueDate(row) + ")");
  } else {
    lines.push("• 임박한 보고 건 없음");
  }
  lines.push(SEPARATOR);

  await sendLongMessage(env, chatId, lines.join("\n"));
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
