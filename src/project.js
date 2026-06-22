// project.js - compact project index and per-project item list.

import { getProjectTimeline } from "./db.js";
import { sendMessage } from "./telegram.js";
import { stripHtml, oneLine, issueDate, issueScore, senderTag } from "./utils.js";

const SEPARATOR = "━━━━━━━━━";
const NOISE_RE = /지원 파일 형식|요약할 내용|권한이 없습니다|원문이 없습니다|^\s*$/;

function normalizeProjectName(project) {
  const p = String(project || "").trim();
  if (/^nexus$/i.test(p) || p === "넥서스") return "nexus";
  return p;
}

function displayProjectName(project) {
  return normalizeProjectName(project) === "nexus" ? "넥서스" : String(project || "").trim();
}

function projectSlug(project) {
  return displayProjectName(project).replace(/<[^>]+>/g, "").trim();
}

function cleanRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const summary = stripHtml(row.summary || "");
    if (!row.project || !summary || NOISE_RE.test(summary)) continue;
    const key = [
      normalizeProjectName(row.project),
      row.source_ref || "",
      summary.replace(/\s+/g, "").slice(0, 100),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sortRows(a, b) {
  const sa = issueScore(a), sb = issueScore(b);
  if (sa !== sb) return sa - sb;
  return String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

function recentRows(rows, count) {
  return rows.slice().sort(sortRows).slice(-count);
}

function progressLine(rows) {
  const joined = rows.map(function (r) { return stripHtml(r.summary); }).join(" ");
  const nums = [];
  const re = /(\d+(?:\.\d+)?)\s*조/g;
  let m;
  while ((m = re.exec(joined)) !== null) {
    const v = parseFloat(m[1]);
    if (nums.indexOf(v) === -1) nums.push(v);
  }
  if (nums.length >= 2) {
    const min = Math.min.apply(null, nums);
    const max = Math.max.apply(null, nums);
    return min + "조 → " + max + "조";
  }
  if (nums.length === 1) return nums[0] + "조";
  return "";
}

function formatItem(tag, row, brief) {
  const limit = brief ? 72 : 90;
  return "  <b>" + tag + "</b> [" + issueDate(row) + "] " + oneLine(row.summary, limit) + senderTag(row);
}

function addMapEntry(map, tag, row) {
  map[tag] = {
    ref: row.source_ref || "",
    summary: row.summary || "",
    project: displayProjectName(row.project || ""),
    date: issueDate(row),
    sender: row.sender || "",
  };
}

function formatOverviewGroup(groupNo, project, rows, map) {
  const sorted = rows.slice().sort(sortRows);
  const shown = recentRows(sorted, 2);
  const lines = [groupNo + ". 📂 [<b>" + displayProjectName(project) + "</b>]"];
  let itemNo = 0;
  for (const row of shown) {
    itemNo++;
    const tag = groupNo + "-" + itemNo;
    addMapEntry(map, tag, row);
    lines.push(formatItem(tag, row, true));
  }
  const prog = progressLine(sorted);
  if (prog) lines.push("  🔍 경과: " + prog);
  lines.push("  전체 보기: <code>/project " + projectSlug(project) + "</code>");
  lines.push("");
  return lines.join("\n");
}

function formatFullGroup(groupNo, project, rows, map) {
  const sorted = rows.slice().sort(sortRows);
  const lines = [groupNo + ". 📂 [<b>" + displayProjectName(project) + "</b>] · 전체 " + sorted.length + "건", ""];
  let itemNo = 0;
  for (const row of sorted) {
    itemNo++;
    const tag = groupNo + "-" + itemNo;
    addMapEntry(map, tag, row);
    lines.push(formatItem(tag, row, false));
  }
  const prog = progressLine(sorted);
  if (prog) lines.push("  🔍 경과: " + prog);
  lines.push("");
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
  const hasName = !!String(name || "").trim();
  const sinceIso = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const rows = await getProjectTimeline(env, name || "", sinceIso);
  const filtered = cleanRows(rows).sort(sortRows);
  if (!filtered.length) {
    if (chatId) await sendMessage(env, chatId, hasName ? "해당 프로젝트 자료가 없습니다." : "최근 1주일간 공유된 프로젝트 자료가 없습니다.");
    return;
  }

  const groups = {};
  for (const row of filtered) {
    const key = normalizeProjectName(row.project);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const keys = Object.keys(groups).sort(function (a, b) { return displayProjectName(a).localeCompare(displayProjectName(b), "ko"); });
  const lines = [
    "📂 <b>프로젝트</b>" + (hasName ? " · " + displayProjectName(name) : " · 최근 1주일"),
    SEPARATOR,
    "",
  ];
  const fullMap = {};
  let groupNo = 0;
  for (const key of keys) {
    groupNo++;
    lines.push(hasName
      ? formatFullGroup(groupNo, key, groups[key], fullMap)
      : formatOverviewGroup(groupNo, key, groups[key], fullMap));
  }
  lines.push(SEPARATOR);
  lines.push("ℹ️ 대외정보 /info · 핵심 /brief");
  lines.push(hasName
    ? "💡 항목 보기: <code>1-1 요약</code> 또는 <code>1-1 자료</code>"
    : "💡 전체 목록: <code>/project 프로젝트명</code> · 항목 보기: <code>1-1 요약</code>");

  if (chatId) {
    try {
      await env.STATE.put("projmap:" + chatId, JSON.stringify(fullMap), { expirationTtl: 1800 });
    } catch (e) { console.error("projmap save", e && e.message); }
  }

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
