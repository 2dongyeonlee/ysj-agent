// project.js - grouped project briefing from structured insights.

import { getProjectTimeline, getSubtasks } from "./db.js";
import { sendMessage } from "./telegram.js";
import { stripHtml, oneLine, issueDate, sortByIssueDate, senderTag } from "./utils.js";

// 하위과제는 DB(project_subtasks)에서 프로젝트별로 조회 (하드코딩 제거)
// 공통 요약·날짜·정렬 함수는 utils.js 단일 소스 사용.
const SEPARATOR = "━━━━━━━━━";

function normalizeProjectName(project) {
  const p = String(project || "").trim();
  if (/^nexus$/i.test(p) || p === "넥서스") return "nexus";
  return p;
}

function displayProjectName(project) {
  return normalizeProjectName(project) === "nexus" ? "넥서스" : project;
}

function subTasks(text, subList) {
  const found = [];
  for (const sub of (subList || [])) {
    if (sub && String(text || "").indexOf(sub) !== -1 && found.indexOf(sub) === -1) found.push(sub);
  }
  return found;
}

function formatSubTask(sub, text) {
  return "  └ " + sub + " — " + oneLine(text);
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

// 그룹번호(1,2..) + 항목번호(1-1,1-2..) 부여. {text, map(tag->row)} 반환.
function formatGroup(groupNo, project, rows, subList) {
  const sorted = rows.slice().sort(sortByIssueDate);
  const lines = [groupNo + ". 📂 [<b>" + displayProjectName(project) + "</b>]", ""];
  const map = {};
  let itemNo = 0;
  for (const row of sorted) {
    itemNo++;
    const tag = groupNo + "-" + itemNo;
    map[tag] = row;
    lines.push("  <b>" + tag + "</b> [" + issueDate(row) + "] " + oneLine(row.summary) + senderTag(row));
    for (const sub of subTasks(row.summary, subList)) lines.push(formatSubTask(sub, row.summary));
  }
  const prog = progressLine(sorted);
  if (prog) lines.push("  🔍 경과: " + prog);
  lines.push(""); // 그룹 사이 빈 줄
  return { text: lines.join("\n"), map: map };
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
  const sinceIso = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const rows = await getProjectTimeline(env, name || "", sinceIso);
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
  const lines = ["📂 <b>프로젝트</b>", SEPARATOR, ""];
  const fullMap = {};
  let groupNo = 0;
  for (const key of keys) {
    groupNo++;
    const subList = await getSubtasks(env, displayProjectName(key));
    const g = formatGroup(groupNo, key, groups[key], subList);
    lines.push(g.text);
    for (const tag in g.map) {
      const r = g.map[tag];
      fullMap[tag] = { ref: r.source_ref || "", summary: r.summary || "", project: r.project || "", date: issueDate(r) };
    }
  }
  lines.push(SEPARATOR);
  lines.push("ℹ️ 대외정보 /info · 핵심 /brief");
  lines.push("💡 항목 보기: <code>1-1 요약</code> 또는 <code>1-1 자료</code>");

  // 번호→항목 매핑을 KV에 10분 저장(chatId별). 직후 번호 입력에 사용.
  if (chatId) {
    try {
      await env.STATE.put("projmap:" + chatId, JSON.stringify(fullMap), { expirationTtl: 600 });
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
