// project.js - grouped project briefing from structured insights.

import { getProjectTimeline } from "./db.js";
import { sendMessage } from "./telegram.js";

// 프로젝트별 하위과제는 본문에서 자연스럽게 드러나므로 고정 리스트 미사용.
const NEXUS_SUBS = [];
const SEPARATOR = "━━━━━━━━━";

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncateWords(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentEnd = head.search(/(?:다|임|음)\.\s|[.!?。]\s/);
  if (sentEnd > 30) return head.slice(0, sentEnd + 1).trim();
  const cut = head.lastIndexOf(" ");
  return (cut > 30 ? head.slice(0, cut) : head).trim() + "…";
}

function firstSentence(text) {
  const cleaned = stripHtml(text)
    .replace(/^📋\s*[^📌\n]+/u, "")
    .replace(/^📄\s*[^🎯\n]+/u, "")
    .replace(/📌\s*핵심\s*/g, "")
    .replace(/🎯\s*핵심:\s*/g, "")
    .replace(/\[(보고요망|보고|공유|참고|검토요망|검토)\]\s*/g, "")
    .replace(/^[•\-]\s*/g, "")
    .trim();
  const bullet = cleaned.match(/(?:^|\s)•\s*([^•\n]+)/);
  const source = bullet ? bullet[1].trim() : cleaned;
  const sentence = source.split(/(?<=[.!?。]|다\.|임\.|음\.)\s+/u)[0] || source;
  return truncateWords(sentence, 120);
}

function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const full = source.match(/20\d{2}[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})/);
  if (full) {
    const month = Number(full[1]);
    const day = Number(full[2]);
    return day > 0 ? month + "/" + day : month + "월";
  }
  const slash = source.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    return day > 0 ? month + "/" + day : month + "월";
  }
  const dotted = source.match(/(\d{1,2})\.(\d{1,2})/);
  if (dotted) {
    const month = Number(dotted[1]);
    const day = Number(dotted[2]);
    return day > 0 ? month + "/" + day : month + "월";
  }
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return Number(korean[1]) + "/" + Number(korean[2]);
  return "—";
}

function sortByIssueDate(a, b) {
  return issueScore(a) - issueScore(b);
}

function issueScore(row) {
  const text = issueDate(row);
  if (text === "—") return 9999;
  const parts = text.split("/");
  const month = parseInt(parts[0], 10);
  const day = parts[1] ? parseInt(parts[1], 10) : 15;
  return month * 100 + day;
}

function normalizeProjectName(project) {
  const p = String(project || "").trim();
  if (/^nexus$/i.test(p) || p === "넥서스") return "nexus";
  return p;
}

function displayProjectName(project) {
  return normalizeProjectName(project) === "nexus" ? "넥서스" : project;
}

function subTasks(text) {
  const found = [];
  for (const sub of NEXUS_SUBS) {
    if (String(text || "").indexOf(sub) !== -1 && found.indexOf(sub) === -1) found.push(sub);
  }
  return found;
}

function formatSubTask(sub, text) {
  return "  └ " + sub + " — " + firstSentence(text);
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
  const first = rows[0] ? firstSentence(rows[0].summary) : "";
  const latest = rows[rows.length - 1] ? firstSentence(rows[rows.length - 1].summary) : "";
  return first && latest && first !== latest ? first + " → " + latest : latest;
}

function formatGroup(project, rows) {
  const sorted = rows.slice().sort(sortByIssueDate);
  const lines = ["📂 [<b>" + displayProjectName(project) + "</b>]"];
  for (const row of sorted) {
    lines.push("• " + firstSentence(row.summary));
    for (const sub of subTasks(row.summary)) lines.push(formatSubTask(sub, row.summary));
  }
  lines.push("🔍 경과: " + progressLine(sorted));
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
  const filtered = (rows || []).filter(function (r) { return r.project; }).sort(sortByIssueDate);
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

  const keys = Object.keys(groups).sort();
  const title = keys.length === 1 ? "📂 프로젝트 · " + displayProjectName(keys[0]) : "📂 프로젝트";
  const lines = [title, SEPARATOR];
  for (const key of keys) lines.push(formatGroup(key, groups[key]));
  lines.push(SEPARATOR);
  lines.push("ℹ️ 대외정보 /info · 핵심 /brief");

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
