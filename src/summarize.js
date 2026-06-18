// summarize.js — 자료 요약. 방·DM에 파일이 올라오면 내용을 요약.
// (KOH봇 ingestAndSummarize 대응). 무음 저장 후, 봇 대상 요청일 때만 응답.
// [stub]

// import { extractText } from "./docparse.js";
// import { callClaude, MODEL_SMART } from "./claude.js";
// import { sendMessage } from "./telegram.js";

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  // TODO:
  //  1) extractText(env, msg) 로 본문 추출
  //  2) files.text 에 저장(검색용) — collect 와 연계
  //  3) callClaude 로 요약
  //  4) replyToUser 면 sendMessage 로 요약 전달, 아니면 무음 저장만
  return null;
}
