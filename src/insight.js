// insight.js — uploaded/content-time structured extraction into insights.
// 분류 방식: project 는 LLM 자유판단이 아니라 "키워드 매칭"으로 결정한다.
// (category/summary/people/schedule 추출은 기존대로 LLM 사용)

import { callClaude, MODEL_FAST } from "./claude.js";
import { getProjectKeywords, updateInsightDone } from "./db.js";

const CATEGORIES = ["정책", "국회", "BH", "글로벌", "언론PR"];

const EXTRACT_SYSTEM = `당신은 염성진 사장님의 자료 분류 비서입니다.
아래 내용을 읽고 JSON만 반환하세요. 마크다운 금지.

스키마:
{
  "schedule": "날짜+안건 (예: 6/20 회장 보고). 없으면 빈 문자열",
  "category": "정책, 국회, BH, 글로벌, 언론PR 중 정확히 하나. 없으면 빈 문자열",
  "summary": "핵심 1-2줄 한국어",
  "people": "관련 인물/소속, 없으면 빈 문자열"
}

category에 복수 값을 넣지 마세요. 모든 값은 한국어로 작성하세요. 모르면 빈 문자열로 두세요. 지어내지 마세요.`;

// ===== 키워드 매칭 헬퍼 (summarize.js 등에서 재사용) =====

// 키워드 사전 로드. 실패 시 [] (분류 보류 폴백).
export async function loadProjectKeywords(env) {
  try {
    return await getProjectKeywords(env);
  } catch (e) {
    console.error("loadProjectKeywords error", e && e.message);
    return null; // null = 조회 실패(분류 보류)
  }
}

// caption -> filename -> body 순으로, 처음 매칭이 나오는 소스의 프로젝트들을 반환.
// keywords: [{project, keyword}] (keyword 는 소문자). 반환: 중복 제거된 프로젝트 배열.
// PR 중요기사: 캡션이 "pr중요기사"로 시작할 때만 포함.
export function matchProjects(keywords, caption, filename, body) {
  if (!keywords || !keywords.length) return [];
  const sources = [
    String(caption || "").toLowerCase(),
    String(filename || "").toLowerCase(),
    String(body || "").toLowerCase(),
  ];
  const capLower = sources[0];
  for (const src of sources) {
    if (!src) continue;
    const hit = [];
    for (const row of keywords) {
      const kw = String(row.keyword || "").toLowerCase();
      if (!kw) continue;
      // PR 중요기사는 캡션이 해당 키워드로 시작할 때만
      if (row.project === "PR 중요기사") {
        if (capLower.indexOf("pr중요기사") === 0 && hit.indexOf(row.project) === -1) hit.push(row.project);
        continue;
      }
      if (src.indexOf(kw) !== -1 && hit.indexOf(row.project) === -1) hit.push(row.project);
    }
    if (hit.length) return hit;
  }
  // 어느 소스에도 일반 매칭이 없어도, 캡션이 pr중요기사로 시작하면 PR 중요기사
  if (capLower.indexOf("pr중요기사") === 0) return ["PR 중요기사"];
  return [];
}

// 후속/완료/긴급 신호
export function detectFollowup(text) {
  return /수정|보완/.test(String(text || "")) ? "수정/보완" : "";
}
export function detectDone(text) {
  return /완료|마무리/.test(String(text || ""));
}
export function detectUrgent(text) {
  return /긴급|보고요망|급|asap/i.test(String(text || ""));
}

function cleanJson(raw) {
  return String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function normalizeCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "대통령실") return "BH";
  const compact = raw.replace(/[\s·\/,|]+/g, "");
  if (compact === "언론PR" || compact === "언론홍보") return "언론PR";
  for (const category of CATEGORIES) {
    if (raw === category || raw.indexOf(category) !== -1) return category;
  }
  return "";
}

export async function extractInsight(env, { chatId, sourceType, sourceRef, text, sender, caption, filename }) {
  try {
    const body = String(text || "").trim();
    if (body.length < 10) return null;
    const readText = body.slice(0, 4000);
    const cap = String(caption || "").trim();
    const fname = String(filename || "").trim();

    const raw = await callClaude(
      env,
      "내용:\n" + readText,
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

    const base = {
      schedule: String(parsed.schedule || "").trim(),
      category: normalizeCategory(parsed.category),
      summary: String(parsed.summary || "").trim(),
      people: String(parsed.people || "").trim(),
    };

    if (!base.schedule && !base.category && !base.summary) {
      return null;
    }

    // ---- 프로젝트 = 키워드 매칭 ----
    const matchText = cap + " " + fname + " " + body;
    let projects = [];
    const keywords = await loadProjectKeywords(env);
    if (keywords === null) {
      projects = []; // 조회 실패 -> 분류 보류(빈 프로젝트로 저장은 계속)
    } else if (body.length >= 10) {
      projects = matchProjects(keywords, cap, fname, body);
    }

    // ---- 후속/완료/긴급 신호 ----
    const followup = detectFollowup(matchText);
    const isDone = detectDone(matchText);
    const urgent = detectUrgent(matchText);
    const summary = (urgent ? "[보고요망] " : "") + base.summary;

    // 매칭된 프로젝트가 없으면 빈 프로젝트 1행, 여러 개면 각각 별도 행
    const targets = projects.length ? projects : [""];
    for (const project of targets) {
      if (project && isDone) {
        try { await updateInsightDone(env, project); } catch (e) { console.error("updateInsightDone error", e && e.message); }
      }
      await env.DB.prepare(
        `INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars, followup, done)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        String(chatId),
        sourceType || "",
        sourceRef || "",
        base.schedule,
        base.category,
        project,
        summary.slice(0, 500),
        base.people,
        sender || "",
        body.length,
        readText.length,
        project ? followup : "",
        (project && isDone) ? 1 : 0
      ).run();
    }

    console.log("insight saved:", (projects.join(",") || base.category || "general"), base.summary.slice(0, 30));
    return { ...base, projects, followup, done: isDone, urgent };
  } catch (e) {
    console.error("extractInsight error", e && (e.stack || e.message) || e);
    return null;
  }
}
