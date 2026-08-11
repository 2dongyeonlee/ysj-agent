// menu.js — 안건 중심 클릭 탐색 구조.
// 메인 메뉴(/start) → 브리핑 안건 / 프로젝트→안건→상세 / 회의록 목록→상세→Action Item / 미완료 AI.
// 생성 로직·프롬프트는 기존 모듈을 재사용하고, 여기서는 조회·조립·버튼만 담당한다.

import { sendMessage } from "./telegram.js";
import { callClaude, MODEL_FAST } from "./claude.js";
import { stripHtml } from "./utils.js";
import { saveActionItems } from "./proactive.js";

export const HOME_ROW = [{ text: "🏠 메뉴", callback_data: "menu_home" }];
const NEED_RE = /확인 필요|확인필요|결정|승인|보고요망|요청/;

// 고정 프로젝트 9종. keys 는 insights.project 매칭용(LIKE).
export const PROJECTS = [
  { label: "Nexus", keys: ["Nexus", "넥서스"] },
  { label: "PJT A", keys: ["PjtA", "PJT A", "Pjt A"] },
  { label: "서남권 지역균형발전", keys: ["서남권"] },
  { label: "G건", keys: ["G건"] },
  { label: "용인 Pull-in", keys: ["용인"] },
  { label: "성과금", keys: ["성과"] },
  { label: "TM PI", keys: ["TM"] },
  { label: "그룹광고", keys: ["광고"] },
  { label: "PR 중요기사", keys: ["PR"] },
];

function projWhere(idx) {
  const p = PROJECTS[idx];
  const conds = p.keys.map(function () { return "project LIKE ?"; }).join(" OR ");
  const binds = p.keys.map(function (k) { return "%" + k + "%"; });
  return { sql: "(" + conds + ")", binds };
}
function day(s) { return String(s || "").slice(5, 10).replace("-", "/"); }
function clean(s, n) { return stripHtml(String(s || "")).replace(/\s+/g, " ").trim().slice(0, n || 70); }

// ── 메인 메뉴 ─────────────────────────────────────────────
export async function sendMainMenu(env, chatId) {
  const rows = [
    [{ text: "📋 오늘 브리핑", callback_data: "menu_brief" }, { text: "🎙 회의록", callback_data: "menu_minutes" }],
    [{ text: "📁 프로젝트", callback_data: "menu_project" }, { text: "✅ Action Item", callback_data: "menu_ai" }],
  ];
  if (env.DASHBOARD_URL && !String(chatId).startsWith("-")) {
    rows.push([{ text: "📊 상황판", web_app: { url: env.DASHBOARD_URL } }]);
  }
  return sendMessage(env, chatId, "무엇을 확인하시겠습니까?", { reply_markup: { inline_keyboard: rows } });
}

// ── 브리핑 안건 상세 (topic:{키워드}) ─────────────────────
export async function showTopic(env, chatId, keyword) {
  const like = "%" + keyword + "%";
  const rows = ((await env.DB.prepare(
    "SELECT summary, schedule, project, created_at FROM insights " +
    "WHERE summary LIKE ? OR schedule LIKE ? OR project LIKE ? ORDER BY created_at DESC LIMIT 5"
  ).bind(like, like, like).all()).results) || [];
  const msgs = rows.length ? [] : (((await env.DB.prepare(
    "SELECT text AS summary, created_at FROM messages WHERE text LIKE ? ORDER BY id DESC LIMIT 5"
  ).bind(like).all()).results) || []);
  const hits = rows.length ? rows : msgs;

  const lines = ["▍<b>" + keyword + "</b>"];
  if (!hits.length) {
    lines.push("관련 자료를 찾지 못했습니다.");
  } else {
    let summary = "";
    try {
      summary = await callClaude(
        env,
        "안건 '" + keyword + "' 관련 자료:\n" + hits.map(function (r) { return "- " + clean(r.summary, 200); }).join("\n"),
        "자료를 근거로 안건 현황을 2~3문장으로 요약. 창작 금지, 이모지·마크다운 금지.",
        MODEL_FAST, 400
      );
    } catch (e) { console.error("topic summary", e && e.message); }
    if (summary) lines.push(clean(summary, 400));
    lines.push("");
    lines.push("<b>최근 경과</b>");
    for (const r of hits) lines.push("· [" + day(r.created_at) + "] " + clean(r.summary, 80));
    const need = hits.find(function (r) { return NEED_RE.test(String(r.summary || "")); });
    if (need) { lines.push(""); lines.push("▶ 확인 필요: " + clean(need.summary, 100)); }
  }
  return sendMessage(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: [HOME_ROW] } });
}

// ── 프로젝트 그리드 (menu_project) ────────────────────────
export async function sendProjectGrid(env, chatId) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const buttons = [];
  for (let i = 0; i < PROJECTS.length; i++) {
    let active = false;
    try {
      const w = projWhere(i);
      const r = await env.DB.prepare(
        "SELECT 1 AS x FROM insights WHERE " + w.sql + " AND created_at >= ? LIMIT 1"
      ).bind(...w.binds, weekAgo).first();
      active = !!r;
    } catch (e) { /* 상태 판정 실패는 ⚪ 로 */ }
    buttons.push({ text: (active ? "🟡 " : "⚪ ") + PROJECTS[i].label, callback_data: "pj:" + i });
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  rows.push(HOME_ROW);
  return sendMessage(env, chatId, "📁 <b>프로젝트</b>\n확인할 프로젝트를 선택하세요. (🟡 최근 활동 · ⚪ 대기)",
    { reply_markup: { inline_keyboard: rows } });
}

// 프로젝트의 최근 30일 안건 후보(중복 제거 상위 4개).
async function projectAgendas(env, idx) {
  const w = projWhere(idx);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = ((await env.DB.prepare(
    "SELECT summary, created_at FROM insights WHERE " + w.sql + " AND created_at >= ? AND summary != '' " +
    "ORDER BY created_at DESC LIMIT 30"
  ).bind(...w.binds, monthAgo).all()).results) || [];
  const seen = new Set(); const out = [];
  for (const r of rows) {
    const kw = clean(r.summary, 10);
    if (kw.length < 2 || seen.has(kw)) continue;
    seen.add(kw);
    out.push({ kw, label: clean(r.summary, 14) });
    if (out.length >= 4) break;
  }
  return out;
}

// ── 프로젝트 카드 (pj:{i}) ────────────────────────────────
export async function sendProjectCard(env, chatId, idx) {
  const p = PROJECTS[idx];
  if (!p) return sendMainMenu(env, chatId);
  const w = projWhere(idx);
  const latest = await env.DB.prepare(
    "SELECT summary, created_at FROM insights WHERE " + w.sql + " AND summary != '' ORDER BY created_at DESC LIMIT 1"
  ).bind(...w.binds).first();
  const active = latest && String(latest.created_at || "") >= new Date(Date.now() - 7 * 86400000).toISOString();
  const agendas = await projectAgendas(env, idx);

  const lines = ["▍<b>" + p.label + "</b> " + (active ? "🟡 진행중" : "⚪ 대기")];
  lines.push(latest ? "현황: " + clean(latest.summary, 150) + " (" + day(latest.created_at) + ")" : "등록된 자료가 없습니다.");
  lines.push("");
  lines.push(agendas.length ? "이 프로젝트의 안건:" : "최근 등록된 안건 없음");

  const rows = [];
  for (let i = 0; i < agendas.length; i += 2) {
    rows.push(agendas.slice(i, i + 2).map(function (a) {
      return { text: a.label, callback_data: "pa:" + idx + ":" + a.kw };
    }));
  }
  rows.push([{ text: "📜 전체 히스토리", callback_data: "ph:" + idx }, HOME_ROW[0]]);
  return sendMessage(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: rows } });
}

// ── 안건 상세 (pa:{i}:{키워드}) ───────────────────────────
export async function sendProjectAgenda(env, chatId, idx, kw) {
  const p = PROJECTS[idx];
  if (!p) return sendMainMenu(env, chatId);
  const w = projWhere(idx);
  const rows = ((await env.DB.prepare(
    "SELECT summary, created_at FROM insights WHERE " + w.sql + " AND summary LIKE ? ORDER BY created_at ASC LIMIT 10"
  ).bind(...w.binds, "%" + kw + "%").all()).results) || [];
  const files = ((await env.DB.prepare(
    "SELECT filename FROM files WHERE (filename LIKE ? OR text LIKE ?) AND filename != '' ORDER BY id DESC LIMIT 3"
  ).bind("%" + p.keys[0] + "%", "%" + kw + "%").all()).results) || [];

  const lines = ["▍<b>" + p.label + "</b> — " + kw, "", "<b>경과</b> (날짜순)"];
  if (rows.length) for (const r of rows) lines.push("· [" + day(r.created_at) + "] " + clean(r.summary, 90));
  else lines.push("· 기록 없음");
  const need = rows.slice().reverse().find(function (r) { return NEED_RE.test(String(r.summary || "")); });
  if (need) { lines.push(""); lines.push("▶ 확인 필요: " + clean(need.summary, 100)); }
  if (files.length) {
    lines.push("");
    lines.push("관련 자료: " + files.map(function (f) { return clean(f.filename, 30); }).join(", "));
  }
  return sendMessage(env, chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: [[{ text: "↩ 프로젝트로", callback_data: "pj:" + idx }, HOME_ROW[0]]] },
  });
}

// ── 회의록 목록 (menu_minutes) ────────────────────────────
export async function sendMinutesList(env, chatId) {
  const rows = ((await env.DB.prepare(
    "SELECT id, filename, created_at FROM files WHERE full_minutes IS NOT NULL AND full_minutes != '' ORDER BY id DESC LIMIT 5"
  ).all()).results) || [];
  if (!rows.length) {
    return sendMessage(env, chatId, "저장된 회의록이 없습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  }
  const kb = rows.map(function (r) {
    const title = clean(r.filename || "회의록", 18) || "회의록";
    return [{ text: "🎙 " + day(r.created_at) + " " + title, callback_data: "min:" + r.id }];
  });
  kb.push(HOME_ROW);
  return sendMessage(env, chatId, "🎙 <b>최근 회의록</b>\n확인할 회의록을 선택하세요.", { reply_markup: { inline_keyboard: kb } });
}

async function minutesRow(env, id) {
  return env.DB.prepare(
    "SELECT id, filename, full_minutes, created_at FROM files WHERE id = ? LIMIT 1"
  ).bind(id).first();
}

// ── 회의록 요약 (min:{id}) ────────────────────────────────
export async function sendMinutesSummary(env, chatId, id) {
  const row = await minutesRow(env, id);
  if (!row || !row.full_minutes) {
    return sendMessage(env, chatId, "회의록을 찾지 못했습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  }
  const title = clean(row.filename || "회의록", 30) || "회의록";
  let body = String(row.full_minutes);
  const truncated = body.length > 1600;
  if (truncated) body = body.slice(0, 1600) + "\n…";
  const text = "🎙 <b>회의록 — " + title + "</b> (" + day(row.created_at) + ")\n\n" + body +
    (truncated ? "\n\n(계속 보려면 [🔊 전체 보기])" : "");
  return sendMessage(env, chatId, text, {
    reply_markup: { inline_keyboard: [
      [{ text: "✅ Action Item", callback_data: "ai:" + id }, { text: "🔊 전체 보기", callback_data: "full:" + id }],
      HOME_ROW,
    ] },
  });
}

// ── 전체 회의록 (full:{id}) ───────────────────────────────
export async function sendFullMinutes(env, chatId, id) {
  const row = await minutesRow(env, id);
  if (!row || !row.full_minutes) {
    return sendMessage(env, chatId, "회의록을 찾지 못했습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  }
  return sendMessage(env, chatId, row.full_minutes, { reply_markup: { inline_keyboard: [HOME_ROW] } });
}

// ── 회의록 Action Item (ai:{id}) ──────────────────────────
export async function sendMinutesActionItems(env, chatId, id) {
  const row = await minutesRow(env, id);
  let items = ((await env.DB.prepare(
    "SELECT id, item_no, content, owner, status FROM action_items WHERE minutes_id = ? ORDER BY item_no, id"
  ).bind(id).all()).results) || [];
  // 저장분이 없으면 회의록 본문에서 추출해 저장 후 재조회 (기존 출력 로직은 무변경 — 저장만 추가).
  if (!items.length && row && row.full_minutes) {
    try { await saveActionItems(env, row.full_minutes, id); } catch (e) { console.error("ai extract", e && e.message); }
    items = ((await env.DB.prepare(
      "SELECT id, item_no, content, owner, status FROM action_items WHERE minutes_id = ? ORDER BY item_no, id"
    ).bind(id).all()).results) || [];
  }
  if (!items.length) {
    return sendMessage(env, chatId, "이 회의록에서 Action Item을 찾지 못했습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  }
  const lines = ["✅ <b>Action Item</b>"];
  items.forEach(function (it, i) {
    const badge = it.status === "done" ? "☑" : "☐";
    lines.push((i + 1) + ". " + badge + " " + clean(it.content, 90) + (it.owner ? " (" + it.owner + ")" : ""));
  });
  const open = items.filter(function (it) { return it.status !== "done"; });
  const kb = [];
  for (let i = 0; i < open.length; i += 3) {
    kb.push(open.slice(i, i + 3).map(function (it) {
      const no = items.indexOf(it) + 1;
      return { text: no + " 완료", callback_data: "aid:" + it.id };
    }));
  }
  kb.push(HOME_ROW);
  return sendMessage(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: kb } });
}

// ── 완료 처리 (aid:{action_item_id}) ──────────────────────
export async function completeActionItem(env, chatId, itemId) {
  const it = await env.DB.prepare("SELECT id, content FROM action_items WHERE id = ? LIMIT 1").bind(itemId).first();
  if (!it) return sendMessage(env, chatId, "항목을 찾지 못했습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  await env.DB.prepare("UPDATE action_items SET status = 'done' WHERE id = ?").bind(itemId).run();
  return sendMessage(env, chatId, "완료 처리됨 ✅ — " + clean(it.content, 80), { reply_markup: { inline_keyboard: [HOME_ROW] } });
}

// ── 미완료 Action Item 통합 (menu_ai) ─────────────────────
export async function sendOpenActionItems(env, chatId) {
  const items = ((await env.DB.prepare(
    "SELECT id, content, owner FROM action_items WHERE status = 'open' ORDER BY id DESC LIMIT 10"
  ).all()).results) || [];
  if (!items.length) {
    return sendMessage(env, chatId, "✅ 미완료 Action Item이 없습니다.", { reply_markup: { inline_keyboard: [HOME_ROW] } });
  }
  const lines = ["✅ <b>미완료 Action Item</b> — " + items.length + "건"];
  items.forEach(function (it, i) {
    lines.push((i + 1) + ". " + clean(it.content, 90) + (it.owner ? " (" + it.owner + ")" : ""));
  });
  const kb = [];
  for (let i = 0; i < items.length; i += 3) {
    kb.push(items.slice(i, i + 3).map(function (it) {
      return { text: (items.indexOf(it) + 1) + " 완료", callback_data: "aid:" + it.id };
    }));
  }
  kb.push(HOME_ROW);
  return sendMessage(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: kb } });
}
