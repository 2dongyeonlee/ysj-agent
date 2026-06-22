// info.js - external-affairs briefing from categorized insights.

import { getInfoInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";
import { oneLine, issueDate, issueScore, senderTag, peopleText } from "./utils.js";

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

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayText() {
  const d = new Date();
  return (d.getMonth() + 1) + "/" + d.getDate();
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
  const items = (rows || []).filter(function (r) { return r.category && r.summary; }).sort(recentFirst);
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
