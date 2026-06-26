// project.js - compact project index and per-project item list.

import { getProjectTimeline } from "./db.js";
import { loadProjectKeywords } from "./insight.js";
import { sendMessage } from "./telegram.js";
import { stripHtml, issueDate, issueScore } from "./utils.js";

const SEPARATOR = "─────";
const NOISE_RE = /지원 파일 형식|요약할 내용|권한이 없습니다|원문이 없습니다|^\s*$/;
const PLACEHOLDER_RE = /^(?:내용\s*확인\s*필요|확인\s*필요|전사\s*내용\s*확인\s*필요|상세\s*확인\s*필요|요약\s*불가|없음|[-—])$/;

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function code(text) {
  return "<code>" + escapeHtml(text) + "</code>";
}

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

function projHeaderName(project, knownSet) {
  const disp = escapeHtml(displayProjectName(project));
  return (knownSet && knownSet.has(normalizeProjectName(project)))
    ? "<u>" + disp + "</u>"
    : disp;
}

function isUnconfirmedSummary(summary) {
  const s = stripHtml(summary || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return true;
  if (PLACEHOLDER_RE.test(s)) return true;
  if (/^\(?내용\s*확인\s*필요\)?$/i.test(s)) return true;
  return false;
}

function cleanRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const summary = stripHtml(row.summary || "");
    if (!row.project || isUnconfirmedSummary(summary) || NOISE_RE.test(summary)) continue;
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

function projectOneLine(text, limit) {
  let s = stripHtml(text || "")
    .replace(/^\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, "")
    .replace(/^📄\s*[^🎯\n]+/u, "")
    .replace(/^📋\s*[^📌\n]+/u, "")
    .replace(/🎯\s*핵심:\s*/g, "")
    .replace(/📌\s*핵심:\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\(([A-Za-z]{1,5}|[가-힣]{2,4})\)\s*$/g, "")
    .trim();

  const bullet = s.match(/(?:^|\s)•\s*([^•\n]+)/);
  if (bullet) s = bullet[1].trim();

  // 완결 문장이면 첫 문장만(2문장째가 짧으면 함께). 본문 substance 를 살린다.
  const sents = s.split(/(?<=[.!?。！？]|다\.|임\.|함\.)\s+/u);
  if (sents[0] && sents[0].length >= 20) {
    s = sents[0].trim();
    if (sents[1] && (s.length + sents[1].length) <= limit) s = (s + " " + sents[1]).trim();
  }

  // 길면 자연스러운 경계에서 자르고 '…'로 마무리. 잘린 조각에 '임'을 억지로 붙이지 않는다.
  let truncated = false;
  if (s.length > limit) {
    const cut = s.slice(0, limit + 1);
    const marks = [cut.lastIndexOf("·"), cut.lastIndexOf(","), cut.lastIndexOf(";"), cut.lastIndexOf(" 및 "), cut.lastIndexOf(" ")];
    const pos = Math.max.apply(null, marks);
    s = (pos > 40 ? cut.slice(0, pos) : s.slice(0, limit)).trim().replace(/[,·;]\s*$/, "");
    truncated = true;
  }

  if (truncated) return s + "…";

  // 잘리지 않은 완결 문장만 가볍게 음슴체로(강제 부착 없음).
  return s
    .replace(/[.]+$/g, "")
    .replace(/입니다$/g, "임")
    .replace(/습니다$/g, "음")
    .replace(/됩니다$/g, "됨")
    .replace(/이다$/g, "임")
    .replace(/한다$/g, "함")
    .replace(/하였다$/g, "함")
    .replace(/했다$/g, "함")
    .trim();
}

function formatItem(tag, row, brief) {
  const limit = brief ? 160 : 220;
  const src = row.filename
    ? " (" + escapeHtml(String(row.filename).replace(/\.(pdf|pptx|docx|m4a|txt)$/i, "")) + ")"
    : "";
  return "  " + tag + " [" + issueDate(row) + "]" + src + " " + projectOneLine(row.summary, limit);
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

function formatOverviewGroup(groupNo, project, rows, map, knownSet) {
  const sorted = rows.slice().sort(sortRows);
  const shown = recentRows(sorted, 2);
  const lines = [groupNo + ". <b>" + projHeaderName(project, knownSet) + "</b>"];
  let itemNo = 0;
  for (const row of shown) {
    itemNo++;
    const tag = groupNo + "-" + itemNo;
    addMapEntry(map, tag, row);
    lines.push(formatItem(tag, row, true));
  }
  const prog = progressLine(sorted);
  if (prog) lines.push("  경과: " + prog);
  lines.push("  전체 보기: " + code("/project " + projectSlug(project)));
  lines.push("");
  return lines.join("\n");
}

function formatFullGroup(groupNo, project, rows, map, knownSet) {
  const sorted = rows.slice().sort(sortRows);
  const lines = [groupNo + ". <b>" + projHeaderName(project, knownSet) + "</b> · 전체 " + sorted.length + "건", ""];
  let itemNo = 0;
  for (const row of sorted) {
    itemNo++;
    const tag = groupNo + "-" + itemNo;
    addMapEntry(map, tag, row);
    lines.push(formatItem(tag, row, false));
  }
  const prog = progressLine(sorted);
  if (prog) lines.push("  경과: " + prog);
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
  const known = await loadProjectKeywords(env);
  const knownSet = new Set((known || []).map(function (r) { return normalizeProjectName(r.project); }));
  const lines = [
    "<b>프로젝트</b>" + (hasName ? " · " + projHeaderName(name, knownSet) : " · 최근 1주일"),
    SEPARATOR,
    "",
  ];
  const fullMap = {};
  let groupNo = 0;
  for (const key of keys) {
    groupNo++;
    lines.push(hasName
      ? formatFullGroup(groupNo, key, groups[key], fullMap, knownSet)
      : formatOverviewGroup(groupNo, key, groups[key], fullMap, knownSet));
  }
  lines.push(SEPARATOR);
  lines.push("대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief");
  lines.push(hasName
    ? "항목 보기: " + code("1-1 요약") + " 또는 " + code("1-1 자료")
    : "전체 목록: " + code("/project 프로젝트명") + " · 항목 보기: " + code("1-1 요약"));

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
