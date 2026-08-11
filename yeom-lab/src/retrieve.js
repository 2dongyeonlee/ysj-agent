// retrieve.js — 기능2: "그 자료 줘 / X에 대해" → 관련 자료·내용 찾아 전달.
// [P4 stub]

// import { searchFiles, searchMessages } from "./db.js";
// import { callClaude } from "./claude.js";
// import { sendDocument, sendMessage } from "./telegram.js";

export async function handleRetrieve(env, chatId, text, msg) {
  // TODO(P4):
  //  1) text 에서 검색 키워드 추출
  //  2) searchFiles → 파일 있으면 sendDocument(file_id) 로 원본 전달
  //  3) 없으면 searchMessages → callClaude 로 내용 요약 응답
  return null; // 아직 미구현
}
