// project.js - grouped project briefing from structured insights.

import { getProjectTimeline } from "./db.js";
import { sendMessage } from "./telegram.js";

const NEXUS_SUBS = ["환경재단", "환경연구재단", "환경 연구재단", "AI교육", "문화 C-Project"];

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

function shortLine(text, max) {
  const s = stripHtml(text);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function normalizeProjectName(project) {
  const p = String(project || "").trim();
  if (/^nexus$/i.test(p) || p === "넥서스") return "nexus";
  return p;
}

function displayProjectName(project) {
  return normalizeProjectName(project) === "nexus" ? "넥서스" : project;
}

function dateText(row) {
  const schedule = String(row.schedule || "").trim();
  if (schedule) return schedule;
  const d = new Date(row.created_at || Date.now());
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function subTasks(text) {
  const found = [];
  for (const sub of NEXUS_SUBS) {
    if (String(text || "").indexOf(sub) !== -1 && found.indexOf(sub) === -1) found.push(sub);
  }
  return found;
}

function formatGroup(project, rows) {
  const latest = rows[rows.length - 1] || {};
  const lines = ["[<b>" + displayProjectName(project) + "</b>] 염성진 총괄 · TF 6/1"];
  for (const row of rows) {
    lines.push("• " + shortLine(row.summary, 190) + " (" + dateText(row) + ")");
    for (const sub of subTasks(row.summary)) {
      lines.push("  └ " + sub + " — " + shortLine(row.summary, 90));
    }
  }
  if (rows.length > 1) lines.push("  └ 최신: " + shortLine(latest.summary, 120));
  return lines.join("\n");
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

export async function runProjectBriefing(env, chatId, days, name) {
  const rows = await getProjectTimeline(env, name || "");
  const filtered = (rows || []).filter(function (r) { return r.project; });
  if (!filtered.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 프로젝트 현황이 없습니다.");
    return;
  }

  const groups = {};
  for (const row of filtered) {
    const key = normalizeProjectName(row.project);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const lines = ["📂 프로젝트", "═══"];
  for (const key of Object.keys(groups).sort()) {
    lines.push(formatGroup(key, groups[key]));
  }
  lines.push("═══");
  lines.push("ℹ️ 대외정보 /info · 핵심 /brief");

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
