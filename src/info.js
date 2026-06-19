// info.js — external-affairs daily briefing. Categories: 정책/국회/BH/글로벌/언론PR.
// Triggered by /info or morning schedule. Source: structured insights.

import { getInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";

const CATEGORIES = ["정책", "국회", "BH", "글로벌", "언론PR"];

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function kstRangeText(fromIso, toDate) {
  const opt = {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const from = new Intl.DateTimeFormat("ko-KR", opt).format(new Date(fromIso));
  const to = new Intl.DateTimeFormat("ko-KR", opt).format(toDate);
  return from + " ~ " + to + " KST";
}

function sourceMeta(row) {
  const input = Number(row.input_chars || 0);
  const read = Number(row.read_chars || 0);
  if (!input || !read) return "";
  if (input > read) return " [" + input + "자 중 " + read + "자 분석]";
  return " [" + read + "자 분석]";
}

function lineFor(row) {
  const sender = row.sender || "발신자 미상";
  const people = row.people ? " / " + row.people : "";
  const schedule = row.schedule ? " / 일정: " + row.schedule : "";
  return "• (" + sender + ") " + row.summary + people + schedule + sourceMeta(row);
}

export async function runInfoBriefing(env, chatId, days) {
  const periodDays = Number(days || 1);
  const to = new Date();
  const since = sinceDaysIso(periodDays);
  const rows = (await getInsightsSince(env, since, {}))
    .filter(function (r) { return r.category; });
  if (!rows || !rows.length) {
    if (chatId) await sendMessage(env, chatId, "📰 <b>대외정보 요약</b>\n기간: " + kstRangeText(since, to) + "\n\n최근 정리할 대외정보가 없습니다.");
    return;
  }

  const lines = [
    "📰 <b>대외정보 요약</b>",
    "기간: " + kstRangeText(since, to),
    "기준: 업로드/메시지 수집 시점에 구조화된 insights " + rows.length + "건",
    "읽기 기준: 메시지는 최대 4,000자, 파일·요약은 최대 9,000자까지 분석해 저장함. 초과분은 각 항목에 표시.",
    "",
  ];

  for (const category of CATEGORIES) {
    const items = rows.filter(function (r) { return r.category === category; });
    if (!items.length) continue;
    lines.push("<b>" + category + "</b>");
    for (const row of items.slice(0, 8)) lines.push(lineFor(row));
    lines.push("");
  }

  const out = lines.join("\n").trim();
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
