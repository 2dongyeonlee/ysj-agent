// project.js — weekly project status. Categories: Nexus/PJT A/서남권/G건/용인 Pull-in/성과금/TM PI/그룹 광고/PR 중요기사/기타.
// Triggered by /project or weekly schedule. Source: all collected messages.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const PROJECT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 수집 메시지에서 주간 프로젝트 진행현황을 고정 카테고리로 분류. 매칭 안 되면 기타.\n" +
  "업데이트 없는 프로젝트는 생략.\n" +
  "프로젝트: Nexus, PJT A, 서남권, G건, 용인 Pull-in, 성과금, TM PI, 그룹 광고, PR 중요기사, 기타\n" +
  "출력 형식:\n\n" +
  "📊 <b>프로젝트 주간 현황</b>\n\n" +
  "<b>Nexus</b>\n• 진행/후속\n\n" +
  "(업데이트 있는 프로젝트만, 위 형식 반복. 매칭 안 되는 건 마지막 기타)\n\n" +
  "<b>기타</b>\n• ...";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runProjectBriefing(env, chatId, days) {
  const rows = (await getInsightsSince(env, sinceDaysIso(days || 7), {}))
    .filter(function (r) { return r.project; });
  if (!rows || !rows.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리할 프로젝트 현황이 없습니다.");
    return;
  }
  const digest = rows.map(function (r) {
    return "[" + r.project + "] " + r.summary + (r.people ? " / " + r.people : "") + (r.schedule ? " / 일정: " + r.schedule : "");
  }).join("\n").slice(0, 14000);
  const out = await callClaude(env, "분류된 프로젝트 현황:\n" + digest, PROJECT_SYSTEM, MODEL_SMART, 2500);
  if (chatId) {
    await sendMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendMessage(env, id, out);
  }
}
