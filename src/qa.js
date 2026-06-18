// qa.js — 일반 질의응답. 봇에게 물으면 답한다.

import { searchMessages } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";

const QA_SYSTEM = `당신은 염성진 사장님의 전담 AI 비서입니다.
사장님과 관련된 대화·자료를 바탕으로 간결하고 정확하게 답변하세요.
모르는 것은 모른다고 솔직히 말하고, 추측은 추측임을 밝히세요.
답변은 핵심만, 간결하게. 이모지 사용 금지.`;

export async function handleQA(env, chatId, question) {
  // 1) 관련 메시지 검색 (최근 수집된 내용 참고)
  let context = "";
  try {
    const rows = await searchMessages(env, question.slice(0, 20));
    if (rows.length) {
      context = "\n\n[참고 대화]\n" + rows.map(r => `${r.sender}: ${r.text}`).join("\n");
    }
  } catch (e) {
    console.error("searchMessages error", e);
  }

  // 2) Claude 응답
  const answer = await callClaude(
    env,
    question + context,
    QA_SYSTEM,
    MODEL_SMART,
    1000
  );

  // 3) 전송
  await sendMessage(env, chatId, answer);
}
