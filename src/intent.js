// intent.js — classify a natural-language message into an intent + target.
// Used in 1:1 so the user can speak naturally without slash commands.
// Conservative: if unsure or it's just info delivery, return "none" (stay silent).

import { callClaude, MODEL_FAST } from "./claude.js";

const INTENT_SYSTEM =
  "You classify a Korean message from President Yeom into ONE intent. " +
  "Return ONLY JSON, no markdown. Schema:\n" +
  '{ "intent": "summary|project|decision|info|brief|question|none", "target": "" }\n' +
  "Decide by the MAIN KEYWORD, ignore time words like 오늘/지금/요즘:\n" +
  "- info: 대외동향/대외/동향/정책/국회/언론/뉴스/이슈 (예: '오늘 대외동향?', '대외동향은?', '요즘 이슈'). 외부 상황을 물으면 info.\n" +
  "- decision: 의사결정/결정/판단/승인 (예: '오늘 의사결정 사항?', '결정할 거 뭐 있어'). 결정할 것을 물으면 decision.\n" +
  "- project: 특정 프로젝트 진행상황 (예: '넥서스 어떻게 됐어?', 'Nexus 현황', 'PJT A 진행'). target=프로젝트명(영문 그대로).\n" +
  "- summary: 자료/문서 요약 요청 (예: '자료 요약해줘', '요약해줘', '방금 거 요약').\n" +
  "- brief: 종합 브리핑 (예: '브리핑 해줘', '현안 정리', '전체 현황').\n" +
  "- question: 위에 안 맞는 일반 질문.\n" +
  "- none: 질문이 아니라 정보 전달/서술 (예: 'A안으로 확정됨', '내일 회의 14시'). 애매하면 none.\n" +
  "KEY: '대외동향' contains 동향 => info, NOT decision. '의사결정/결정' => decision. Match the noun, not the time word.\n" +
  "Only choose a specific intent when clearly ASKING. Plain statements => none.";

export async function classifyIntent(env, text) {
  if (!text || text.length < 2) return { intent: "none", target: "" };
  try {
    const raw = await callClaude(env, "메시지: " + text.slice(0, 500), INTENT_SYSTEM, MODEL_FAST, 150);
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!parsed || !parsed.intent) return { intent: "none", target: "" };
    return { intent: parsed.intent, target: parsed.target || "" };
  } catch (e) {
    console.error("intent classify error", e && e.message);
    return { intent: "none", target: "" }; // fail safe = silent
  }
}
