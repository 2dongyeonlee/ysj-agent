// decision.js — collect items needing the president's decision, from insights + recent messages.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const DECISION_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래 정보에서 염 사장의 판단·결정이 필요한 사항만 추려 정리. " +
  "결정 불필요한 단순 정보는 제외. 한 항목 1줄, 안건·기한 <b>굵게</b>.\n" +
  "결정 필요사항이 하나도 없으면 정확히 'NONE' 만 출력.\n" +
  "출력 형식:\n\n" +
  "• <b>[기한]</b> <b>안건</b> — 판단 포인트 한 줄";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// 의사결정 본문(섹션)만 생성해 문자열로 반환. 없으면 "". (brief 에서 재사용)
export async function buildDecisionText(env, days) {
  const rows = await getInsightsSince(env, sinceDaysIso(days || 14), {});
  if (!rows || !rows.length) return "";
  const digest = rows.map(function (r) {
    return (r.schedule ? "[" + r.schedule + "] " : "") + r.summary + (r.people ? " (" + r.people + ")" : "");
  }).join("\n");
  const out = await callClaude(env, "정보 항목:\n" + digest, DECISION_SYSTEM, MODEL_SMART, 1500);
  const trimmed = String(out || "").trim();
  if (!trimmed || trimmed.toUpperCase() === "NONE") return "";
  return trimmed;
}

// 폴백: 단독 /decision (현재 라우팅은 /brief 로 통합). 보존만.
export async function runDecisionBriefing(env, chatId, days) {
  const body = await buildDecisionText(env, days);
  if (!body) {
    return sendMessage(env, chatId, "현재 정리된 의사결정 사항이 없습니다.");
  }
  await sendMessage(env, chatId, "💡 <b>의사결정 필요사항</b>\n\n" + body);
}
