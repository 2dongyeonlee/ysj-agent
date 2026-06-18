// summarize.js — summarize a single uploaded file (title + key points).

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { extractInsight } from "./insight.js";

const SUMMARY_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 업로드된 문서를 염 사장 관점에서 요약.\n" +
  "출력 형식:\n\n" +
  "📋 <b>{문서 제목}</b>\n\n" +
  "📌 핵심 요약\n" +
  "• {핵심 2-3줄. 사장 판단/보고 필요사항 있으면 포함}";

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  const text = await extractText(env, msg);
  if (!text) return;
  await extractInsight(env, {
    chatId: msg.chat.id,
    sourceType: "file",
    sourceRef: (msg.document && msg.document.file_id) || "",
    text,
  });
  try {
    await env.DB.prepare(
      "UPDATE files SET text = ? WHERE id = (SELECT id FROM files WHERE chat_id = ? ORDER BY id DESC LIMIT 1)"
    ).bind(text.slice(0, 5000), String(msg.chat.id)).run();
  } catch (e) {
    console.error("files text update error", e && e.message);
  }
  if (!replyToUser) return;
  const summary = await callClaude(env, "문서 내용:\n" + text.slice(0, 6000), SUMMARY_SYSTEM, MODEL_SMART, 1200);
  await sendMessage(env, chatId, summary);
}
