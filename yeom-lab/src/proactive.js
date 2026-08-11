// proactive.js — 목업②: 선제 알림 기반 (schedules / action_items / subscriptions).
// 기존 파이프라인 로직은 건드리지 않고, 훅으로 "추가"만 한다.

import { sendMessage } from "./telegram.js";

function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function pad(n) { return String(n).padStart(2, "0"); }
function kstDay(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }

// 날짜·시간 패턴 감지 → { title, startAt } | null
// 예: "7/30 10:00 임원회의", "7월 30일 14시", "내일 14:00 미팅", "오늘 15시 보고"
export function detectSchedule(text, base = kstNow()) {
  const t = String(text || "").trim();
  if (!t || t.length > 1000) return null;
  let mo, d, hh, mi, matched;
  let m = t.match(/(\d{1,2})[\/월]\s*(\d{1,2})일?\s*(?:\([^)]{1,4}\)\s*)?(\d{1,2})[:시]\s*(\d{2})?/);
  if (m) {
    mo = +m[1]; d = +m[2]; hh = +m[3]; mi = +(m[4] || 0); matched = m[0];
  } else {
    m = t.match(/(오늘|내일|모레)\s*(?:\([^)]{1,4}\)\s*)?(\d{1,2})[:시]\s*(\d{2})?/);
    if (!m) return null;
    const add = m[1] === "오늘" ? 0 : m[1] === "내일" ? 1 : 2;
    const dt = new Date(base.getTime() + add * 86400000);
    mo = dt.getUTCMonth() + 1; d = dt.getUTCDate(); hh = +m[2]; mi = +(m[3] || 0); matched = m[0];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;
  const startAt = base.getUTCFullYear() + "-" + pad(mo) + "-" + pad(d) + "T" + pad(hh) + ":" + pad(mi);
  let title = t.split("\n")[0].replace(matched, " ")
    .replace(/(오늘|내일|모레)/g, " ")
    .replace(/^[\s\-–—:,.·]+|[\s\-–—:,.·]+$/g, "").trim();
  if (!title) title = "일정";
  return { title: title.slice(0, 80), startAt };
}

// 메시지 수집 훅 — 일정 패턴이 보이면 schedules 에 저장(실패해도 본 처리에 영향 없음).
export async function saveScheduleFromText(env, msg, text) {
  const hit = detectSchedule(text);
  if (!hit) return null;
  await env.DB.prepare(
    "INSERT INTO schedules (title, start_at, location, attendees, source_msg_id) VALUES (?, ?, '', '', ?)"
  ).bind(hit.title, hit.startAt, (msg && msg.message_id) || 0).run();
  return hit;
}

// 회의록 텍스트에서 Action Item 항목 추출.
export function extractActionItems(minutesText) {
  const t = String(minutesText || "");
  const m = t.match(/Action\s*Item[^\n]*\n([\s\S]*?)(?=\n\s*[■─]|$)/i);
  if (!m) return [];
  return m[1].split("\n")
    .map(function (s) { return s.replace(/^[\s•\-\*\d.)]+/, "").replace(/<\/?[a-zA-Z]+>/g, "").trim(); })
    .filter(function (s) { return s.length >= 2 && !/^없음/.test(s); })
    .slice(0, 10);
}

// 회의록 생성 훅 — Action Item 을 open 상태로 저장.
export async function saveActionItems(env, minutesText, minutesId = 0) {
  const items = extractActionItems(minutesText);
  for (const content of items) {
    try {
      await env.DB.prepare(
        "INSERT INTO action_items (minutes_id, content, owner, status) VALUES (?, ?, '', 'open')"
      ).bind(minutesId, content.slice(0, 300)).run();
    } catch (e) { console.error("saveActionItems", e && e.message); }
  }
  return items.length;
}

// 이슈 추적 구독 등록 ([📌 이슈 추적] 버튼).
export async function addSubscription(env, chatId, keyword) {
  await env.DB.prepare(
    "INSERT INTO subscriptions (chat_id, keyword) VALUES (?, ?)"
  ).bind(String(chatId), String(keyword || "").slice(0, 100)).run();
}

// 매일 18:00 KST cron — 내일 일정 사전 브리핑. 내일 일정 없으면 침묵(빈 알림 금지).
// replyChatId 지정 시(수동 테스트 /alerttest) 그 방으로만 발송하고, 없어도 안내한다.
export async function runTomorrowAlert(env, replyChatId) {
  const tomorrow = new Date(kstNow().getTime() + 86400000);
  const day = kstDay(tomorrow);
  const rows = ((await env.DB.prepare(
    "SELECT title, start_at FROM schedules WHERE start_at LIKE ? ORDER BY start_at LIMIT 10"
  ).bind(day + "%").all()).results) || [];
  if (!rows.length) {
    if (replyChatId) await sendMessage(env, replyChatId, "내일(" + day + ") 일정이 없어 알림을 보내지 않습니다.");
    return;
  }
  const aiCount = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM action_items WHERE status='open'"
  ).first()) || { n: 0 };
  const top = ((await env.DB.prepare(
    "SELECT content FROM action_items WHERE status='open' ORDER BY id DESC LIMIT 3"
  ).all()).results) || [];

  const lines = ["🔔 <b>내일 일정 사전 브리핑</b>", ""];
  for (const r of rows) {
    lines.push("• 내일 " + String(r.start_at).slice(11, 16) + " <b>" + r.title + "</b>");
  }
  if (aiCount.n > 0) {
    lines.push("");
    lines.push("미완료 Action Item " + aiCount.n + "건:");
    for (const a of top) lines.push("- " + a.content);
  }
  const targets = replyChatId
    ? [replyChatId]
    : String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  for (const id of targets) {
    try { await sendMessage(env, id, lines.join("\n")); }
    catch (e) { console.error("tomorrow alert send", e && e.message); }
  }
}
