// extract.js — 메시지/파일에서 "누구를 만났는지"를 추출해 engagements 에 축적.
// collect 중 자동 호출. 기능3·4(접촉/만나기전 브리핑)의 데이터를 여기서 쌓는다.
// [P3 stub] 오늘은 골격만. 브리핑(기능1) 검증 후 채운다.

// import { callClaude, MODEL_FAST } from "./claude.js";
// import { findContact, insertContact, insertEngagement } from "./db.js";

// 메시지가 "접촉 언급"인지 가볍게 판별 → 맞으면 추출·저장
export async function maybeExtractEngagement(env, msg, text) {
  // TODO(P3):
  //  1) 1차 필터: '만났다/미팅/통화/면담' 등 신호어 또는 LLM 짧은 판별
  //  2) callClaude 로 {인물, 소속, 주제, 일시, 채널, 핵심, 후속} 추출
  //  3) findContact 별칭매칭 → 없으면 insertContact
  //  4) insertEngagement (source_type='message', source_ref=message_id)
  return null; // 아직 미구현 (collect 는 정상 동작, 추출만 보류)
}
