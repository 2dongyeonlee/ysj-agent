// insight.js — uploaded/content-time structured extraction into insights.

import { callClaude, MODEL_FAST } from "./claude.js";

const EXTRACT_SYSTEM = `당신은 염성진 사장님의 자료 분류 비서입니다.
아래 내용을 읽고 JSON만 반환하세요. 마크다운 금지.

스키마:
{
  "schedule": "날짜+안건 (예: 6/20 회장 보고). 없으면 빈 문자열",
  "category": "정책|국회|BH|글로벌|언론PR 중 하나. 없으면 빈 문자열",
  "project": "Nexus|PJT A|서남권|G건|용인 Pull-in|성과금|TM PI|그룹 광고|PR 중요기사|기타 중 하나. 없으면 빈 문자열",
  "summary": "핵심 1-2줄 한국어",
  "people": "관련 인물/소속, 없으면 빈 문자열"
}

모든 값은 한국어로 작성하세요. 모르면 빈 문자열로 두세요. 지어내지 마세요.`;

function cleanJson(raw) {
  return String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function extractInsight(env, { chatId, sourceType, sourceRef, text }) {
  try {
    const body = String(text || "").trim();
    if (body.length < 10) return null;

    const raw = await callClaude(
      env,
      "내용:\n" + body.slice(0, 4000),
      EXTRACT_SYSTEM,
      MODEL_FAST,
      500
    );

    let parsed;
    try {
      parsed = JSON.parse(cleanJson(raw));
    } catch (e) {
      console.error("insight parse error", e && e.message);
      return null;
    }

    const insight = {
      schedule: String(parsed.schedule || "").trim(),
      category: String(parsed.category || "").trim(),
      project: String(parsed.project || "").trim(),
      summary: String(parsed.summary || "").trim(),
      people: String(parsed.people || "").trim(),
    };

    if (!insight.schedule && !insight.category && !insight.project && !insight.summary) {
      return null;
    }

    await env.DB.prepare(
      `INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      String(chatId),
      sourceType || "",
      sourceRef || "",
      insight.schedule,
      insight.category,
      insight.project,
      insight.summary,
      insight.people
    ).run();

    console.log("insight saved:", insight.category || insight.project || "general", insight.summary.slice(0, 30));
    return insight;
  } catch (e) {
    console.error("extractInsight error", e && (e.stack || e.message) || e);
    return null;
  }
}
