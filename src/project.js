// project.js — weekly project status from structured insights.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const PROJECT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래 항목을 프로젝트별로만 정리. 각 항목의 [프로젝트명]을 그대로 제목으로 사용.\n" +
  "절대 규칙:\n" +
  "- 제목은 입력에 있는 [프로젝트명]만 사용. '정치 동향', '경쟁사 동향', '정책 동향' 같은 새 카테고리/소제목을 만들지 말 것.\n" +
  "- 입력에 없는 내용을 추가하지 말 것. 대외동향·뉴스는 프로젝트가 아니므로 포함하지 말 것.\n" +
  "- 한 프로젝트당 1-2줄. 날짜·사람·안건 <b>강조</b>.\n" +
  "- 항목 끝의 (후속:수정/보완) 표시는 '후속(수정/보완)'으로, (완료) 표시는 '✅ 완료'로 반영.\n" +
  "출력 형식:\n\n" +
  "📊 <b>프로젝트 주간 현황</b>\n\n" +
  "<b>{프로젝트명}</b>\n• 1-2줄 진행/후속\n\n" +
  "(입력에 있는 프로젝트만 반복. 동향·이슈 소제목 금지)";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runProjectBriefing(env, chatId, days, name) {
  const rows = await getInsightsSince(env, sinceDaysIso(days || 7), {});
  let proj = (rows || []).filter(function (r) { return r.project && r.project !== "기타"; });
  if (name) proj = proj.filter(function (r) { return (r.project || '').toLowerCase().indexOf(name.toLowerCase()) !== -1; });
  if (!proj.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리할 프로젝트 현황이 없습니다.");
    return;
  }
  const digest = proj.map(function (r) {
    return "[" + r.project + "] " + r.summary +
      (r.schedule ? " / " + r.schedule : "") +
      (r.people ? " (" + r.people + ")" : "") +
      (r.followup ? " (후속:" + r.followup + ")" : "") +
      (r.done ? " (완료)" : "");
  }).join("\n");
  const out = await callClaude(env, "프로젝트 항목:\n" + digest, PROJECT_SYSTEM, MODEL_SMART, 2000);
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
