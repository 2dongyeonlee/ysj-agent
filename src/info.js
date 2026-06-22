// info.js - external-affairs briefing from categorized insights.

import { getInfoInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";
import { oneLine, issueDate, issueScore, senderTag, peopleText, stripHtml } from "./utils.js";

function recentFirst(a, b) {
  const sa = issueScore(a), sb = issueScore(b);
  const ua = sa === 9999, ub = sb === 9999;
  if (ua !== ub) return ua ? 1 : -1;
  return sb - sa;
}

const INFO_CATEGORIES = [
  { name: "정부", icon: "🏢" },
  { name: "BH", icon: "🇰🇷" },
  { name: "글로벌", icon: "🌐" },
  { name: "국회", icon: "🏛" },
  { name: "언론", icon: "🗞" },
];

const SEPARATOR = "━━━━━━━━━";
const STOPWORDS = new Set([
  "보고요망", "관련", "통해", "대한", "대해", "하며", "하고", "있다", "있음", "중임",
  "필요", "강화", "추진", "가능성", "상황", "제기", "예정", "자료", "브리핑",
]);

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayText() {
  const d = new Date();
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function tokens(row) {
  const text = (stripHtml(row.summary || "") + " " + stripHtml(row.people || ""))
    .replace(/\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, "")
    .replace(/[0-9]+(?:\.[0-9]+)?/g, " ")
    .replace(/[^\p{L}A-Za-z]+/gu, " ")
    .toLowerCase();
  const raw = text.split(/\s+/).filter(function (t) { return t.length >= 2 && !STOPWORDS.has(t); });
  return Array.from(new Set(raw));
}

function sameIssue(a, b) {
  if (a.category !== b.category) return false;
  const da = issueDate(a), db = issueDate(b);
  const sameDate = da === "—" || db === "—" || da === db;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  let common = 0;
  for (const t of ta) if (setB.has(t)) common++;
  const score = common / Math.min(ta.length, tb.length);
  return sameDate ? score >= 0.5 : score >= 0.75;
}

function dedupeIssues(rows) {
  const kept = [];
  for (const row of rows) {
    if (kept.some(function (prev) { return sameIssue(prev, row); })) continue;
    kept.push(row);
  }
  return kept;
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

export async function runInfoBriefing(env, chatId, days) {
  const rows = await getInfoInsightsSince(env, sinceDaysIso(days || 14), INFO_CATEGORIES.map(function (c) { return c.name; }));
  const items = dedupeIssues((rows || []).filter(function (r) { return r.category && r.summary; }).sort(recentFirst));
  if (!items.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  const lines = ["📊 대외정보 · " + todayText(), SEPARATOR, ""];
  for (const cat of INFO_CATEGORIES) {
    const grouped = items.filter(function (r) { return r.category === cat.name; });
    if (!grouped.length) continue;
    lines.push(cat.icon + " <b>" + cat.name + "</b>");
    for (const row of grouped) {
      const who = peopleText(row);
      const head = who ? "<b>" + who + "</b> — " : "";
      lines.push("• [" + issueDate(row) + "] " + head + oneLine(row.summary) + senderTag(row));
    }
    lines.push("");
  }
  lines.push(SEPARATOR);
  lines.push("ℹ️ 프로젝트 /project · 핵심 /brief");

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
