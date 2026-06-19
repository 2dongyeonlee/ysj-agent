// project.js — weekly project status from structured insights.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const PROJECT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래 구조화된 프로젝트 항목을 프로젝트별로 정리. 한 항목 1줄, 날짜·사람·안건 강조.\n" +
  "업데이트 없는 프로젝트는 생략.\n" +
  "출력 형식:\n\n" +
  "📊 <b>프로젝트 주간 현황</b>\n\n" +
  "<b>{프로젝트명}</b>\n• 1줄 진행/후속\n\n" +
  "(업데이트 있는 프로젝트만 반복)";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runProjectBriefing(env, chatId, days, name) {
  const rows = await getInsightsSince(env, sinceDaysIso(days || 7), {});
  let proj = (rows || []).filter(function (r) { return r.project; });
  if (name) proj = proj.filter(function (r) { return (r.project || '').toLowerCase().indexOf(name.toLowerCase()) !== -1; });
  if (!proj.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리할 프로젝트 현황이 없습니다.");
    return;
  }
  const digest = proj.map(function (r) {
    return "[" + r.project + "] " + r.summary + (r.schedule ? " / " + r.schedule : "") + (r.people ? " (" + r.people + ")" : "");
  }).join("\n");
  const out = await callClaude(env, "프로젝트 항목:\n" + digest, PROJECT_SYSTEM, MODEL_SMART, 2000);
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
