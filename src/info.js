// info.js - external-affairs briefing from categorized insights.

import { getInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";

const INFO_CATEGORIES = [
  { name: "정부", icon: "🏢" },
  { name: "BH", icon: "🇰🇷" },
  { name: "글로벌", icon: "🌐" },
  { name: "국회", icon: "🏛" },
  { name: "언론", icon: "🗞" },
];

const SEPARATOR = "━━━━━━━━━";

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

function issueStamp(row) {
  const date = issueDate(row);
  const raw = String(row.sender || row.author || "").trim();
  const sender = raw ? raw.split(/\s+/)[0] : "—";
  return date + "·<b>" + sender + "</b>";
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

export async function runInfoBriefing(env, chatId, days) {
  const rows = await getInsightsSince(env, sinceDaysIso(days || 14), {
    categoryIn: INFO_CATEGORIES.map(function (c) { return c.name; }),
    projectEmpty: true,
  });
  const items = (rows || []).filter(function (r) { return r.category && r.summary; }).sort(sortByIssueDate);
  if (!items.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  const lines = ["📊 대외정보 · " + todayText(), SEPARATOR];
  for (const cat of INFO_CATEGORIES) {
    const grouped = items.filter(function (r) { return r.category === cat.name; });
    if (!grouped.length) continue;
    lines.push(cat.icon + " <b>" + cat.name + "</b>");
    for (const row of grouped) {
      lines.push("• " + firstSentence(row.summary) + " (" + issueStamp(row) + ")");
    }
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
