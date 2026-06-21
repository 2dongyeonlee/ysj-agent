// info.js - external-affairs briefing from categorized insights.

import { getInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";

const INFO_CATEGORIES = [
  { name: "정부", icon: "🏢" },
  { name: "국회", icon: "🏛" },
  { name: "BH", icon: "🇰🇷" },
  { name: "글로벌", icon: "🌐" },
  { name: "언론", icon: "📰" },
];

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

function shortLine(text, max) {
  const s = stripHtml(text);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function md(row) {
  const explicit = String(row.report_date || "").trim();
  if (explicit && explicit !== "—") return explicit;
  const d = new Date(row.created_at || Date.now());
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function author(row) {
  const name = String(row.author || row.sender || "").trim();
  return name && name !== "—" ? name : "—";
}

function boldPeople(text, people) {
  let out = text;
  for (const raw of String(people || "").split(/[,\n/·]+/)) {
    const name = raw.trim();
    if (name.length < 2 || out.indexOf("<b>" + name + "</b>") !== -1) continue;
    out = out.split(name).join("<b>" + name + "</b>");
  }
  return out;
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
  const items = (rows || []).filter(function (r) { return r.category && r.summary; });
  if (!items.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  const lines = ["📊 대외정보", "═══"];
  for (const cat of INFO_CATEGORIES) {
    const grouped = items.filter(function (r) { return r.category === cat.name; });
    if (!grouped.length) continue;
    lines.push(cat.icon + " <b>" + cat.name + "</b>");
    for (const row of grouped) {
      const body = boldPeople(shortLine(row.summary, 220), row.people);
      lines.push("• " + body + " (" + md(row) + " <b>" + author(row) + "</b>)");
    }
  }
  lines.push("═══");
  lines.push("ℹ️ 프로젝트 /project · 핵심 /brief");

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
