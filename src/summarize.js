// summarize.js — 자료 요약. 파일 올라오면 텍스트 추출 → files.text 저장 → (요청 시) 요약 응답.

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";

const SUMMARY_SYSTEM = `당신은 염성진 사장님의 전담 비서입니다.
문서를 사장님 관점에서 분석해 아래 양식으로만 답하세요. 없는 항목은 "없음". 마크다운 금지.

일정: (캘린더에 넣을 날짜·마감)
의사결정사항: (사장님 판단이 필요한 사항)
핵심 요약: (2~3줄)`;

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  const text = await extractText(env, msg);
  if (!text) return;

  // files 테이블의 가장 최근 행(collect가 방금 넣은 것)에 추출 텍스트 채우기
  try {
    await env.DB.prepare(
      `UPDATE files SET text = ? WHERE chat_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(text.slice(0, 5000), String(msg.chat.id)).run();
  } catch (e) {
    console.error("files text update error", e?.message);
  }

  if (!replyToUser) return; // 무음 저장만

  const summary = await callClaude(env, `문서:\n${text.slice(0, 6000)}`, SUMMARY_SYSTEM, MODEL_SMART, 1500);
  await sendMessage(env, chatId, summary);
}
