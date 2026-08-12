// report.js — work reports / high-level drafts. Persona-driven report style.

import { getMessagesSince, getRecentEngagements } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const WEEKLY_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 수집 메시지로 주간 업무보고 작성.\n" +
  "출력 형식:\n\n" +
  "📅 <b>주간 업무보고</b>\n\n" +
  "📌 주요 진행\n• <b>{과제}</b> / <u>{담당}</u>\n └ 핵심 한 줄\n\n" +
  "🔔 완료·보고\n• <b>{건명}</b> / <u>{담당}</u>\n └ 결과\n\n" +
  "💡 의사결정 필요\n• {사장 판단 필요 사항}";

const HIGHLEVEL_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 회장님·의장님께 올릴 보고 초안 작성. 최고위 보고 수준, 매우 간결.\n" +
  "출력 형식:\n\n" +
  "📋 <b>보고 초안</b>\n\n" +
  "📌 핵심 성과\n• {1-2줄}\n\n" +
  "💡 주요 이슈·의사결정\n• {이슈}\n\n" +
  "📅 향후 계획\n• {계획}";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runWeeklyReport(env, chatId, days) {
  const n = days || 7;
  const rows = await getMessagesSince(env, [String(chatId)], sinceDaysIso(n));
  if (!rows || !rows.length) {
    return sendMessage(env, chatId, "최근 " + n + "일간 정리할 내용이 없습니다.");
  }
  const digest = rows.map(function (r) { return "[" + r.sender + "] " + r.text; }).join("\n");
  const out = await callClaude(env, "최근 " + n + "일 대화:\n" + digest, WEEKLY_SYSTEM, MODEL_SMART, 1800);
  await sendMessage(env, chatId, out);
}

export async function runHighLevelDraft(env, chatId, days) {
  const n = days || 14;
  const msgs = await getMessagesSince(env, [String(chatId)], sinceDaysIso(n));
  const engs = await getRecentEngagements(env, sinceDaysIso(n));
  const parts = [];
  if (msgs && msgs.length) {
    parts.push("[활동/보고]\n" + msgs.map(function (r) { return "- " + r.sender + ": " + r.text; }).join("\n"));
  }
  if (engs && engs.length) {
    parts.push("[대외 접촉]\n" + engs.map(function (e) {
      return "- " + (e.name || "?") + "(" + (e.org || "") + ") " + e.topic + ": " + e.summary;
    }).join("\n"));
  }
  if (!parts.length) {
    return sendMessage(env, chatId, "보고 초안을 만들 데이터가 아직 없습니다.");
  }
  const out = await callClaude(env, parts.join("\n\n"), HIGHLEVEL_SYSTEM, MODEL_SMART, 2000);
  await sendMessage(env, chatId, out);
}
