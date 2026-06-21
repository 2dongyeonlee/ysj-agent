// insight.js - uploaded/content-time structured extraction into insights.
// project = keyword matching, info category = LLM classification. They are stored separately.

import { callClaude, MODEL_FAST } from "./claude.js";
import { getProjectKeywords, updateInsightDone } from "./db.js";

const INFO_CATEGORIES = ["국회", "정부", "BH", "글로벌", "언론"];

const EXTRACT_SYSTEM = `당신은 염성진 사장 대외정보 정리 비서다. 입력은 담당자가 공유한 DM 원문이다.
JSON만 반환하라. 마크다운 금지.

[분류] category는 아래 5개 중 하나만 쓴다. 그 외 분류 생성 금지.
안 맞으면 가장 가까운 분류로 배정하되, 대외정보가 아니면 빈 문자열로 둔다.
- 국회: 입법·의원·상임위·법안·정당
- 정부: 부처·공정위·산업부·규제기관
- BH: 대통령(V)·대통령실·총리·인선
- 글로벌: 해외기업·국제 산업동향·통상
- 언론: 보도·기사·PR·미디어 대응·재단/캠페인 (대면·정세 구분 없이 모두 여기)

[보존] 원문 항목을 합치지 말고 핵심을 1~2줄로 남긴다.
사람을 만난 내용이면 만난 사람·소속을 summary 또는 people에 포함한다.

[금지] 작성자·날짜·분류를 추론 생성하지 않는다. 결정사항·출처는 문서에 명시된 것만 쓴다.
"예정/검토중/논의/토의"는 결정이 아니다.

스키마:
{
  "schedule": "날짜+안건. 없으면 빈 문자열",
  "category": "국회, 정부, BH, 글로벌, 언론 중 하나. 대외정보가 아니면 빈 문자열",
  "summary": "핵심 1~2줄",
  "people": "관련 인물/소속. 없으면 빈 문자열",
  "decision": "문서에서 확정/결정/승인된 사항만. 없으면 빈 문자열",
  "source": "결정 근거 출처가 명시돼 있으면 그대로. 없으면 빈 문자열"
}`;

export async function loadProjectKeywords(env) {
  try {
    return await getProjectKeywords(env);
  } catch (e) {
    console.error("loadProjectKeywords error", e && e.message);
    return null;
  }
}

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
      if (row.project === "PR 중요기사") {
        if (capLower.indexOf("pr중요기사") === 0 && hit.indexOf(row.project) === -1) hit.push(row.project);
        continue;
      }
      if (src.indexOf(kw) !== -1 && hit.indexOf(row.project) === -1) hit.push(row.project);
    }
    if (hit.length) return hit;
  }
  if (capLower.indexOf("pr중요기사") === 0) return ["PR 중요기사"];
  return [];
}

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
  if (raw === "정책") return "정부";
  if (raw === "언론PR" || raw === "언론홍보" || raw === "PR") return "언론";
  for (const category of INFO_CATEGORIES) {
    if (raw === category || raw.indexOf(category) !== -1) return category;
  }
  return "";
}

export function normalizeDecision(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/예정|검토|논의|토의|계획/.test(raw)) return "";
  if (!/확정|결정|승인/.test(raw)) return "";
  return raw;
}

export function normalizeSource(value) {
  return String(value || "").trim();
}

export function parseInfoMeta(text, fallbackSender, fallbackDate) {
  const body = String(text || "");
  const header = body.match(/^\[[^\]]+\]\s*(.+?):/m);
  const author = (header && header[1] ? header[1].trim() : String(fallbackSender || "").trim()) || "—";

  const daily = body.match(/<Daily>\s*(\d{1,2})\/(\d{1,2})/i);
  const dated = daily || body.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/m);
  let reportDate = dated ? Number(dated[1]) + "/" + Number(dated[2]) : "";
  if (!reportDate && fallbackDate) {
    const d = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    if (!Number.isNaN(d.getTime())) reportDate = (d.getMonth() + 1) + "/" + d.getDate();
  }
  return { author, reportDate: reportDate || "—" };
}

function looksLikeInfoText(text, category) {
  if (category) return true;
  return /국회|의원|상임위|법안|정당|정부|부처|공정위|공정거래위원회|산업부|규제|대통령|대통령실|총리|인선|글로벌|해외|통상|언론|기사|보도|PR|미디어|재단|캠페인/.test(String(text || ""));
}

async function insertInsight(env, row) {
  await env.DB.prepare(
    `INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars, followup, done, decision, source, author, report_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    String(row.chatId),
    row.sourceType || "",
    row.sourceRef || "",
    row.schedule || "",
    row.category || "",
    row.project || "",
    String(row.summary || "").slice(0, 500),
    row.people || "",
    row.sender || "",
    row.inputChars || 0,
    row.readChars || 0,
    row.followup || "",
    row.done ? 1 : 0,
    row.decision || null,
    row.source || null,
    row.author || null,
    row.reportDate || null
  ).run();
}

export async function extractInsight(env, { chatId, sourceType, sourceRef, text, sender, caption, filename, receivedAt }) {
  try {
    const body = String(text || "").trim();
    if (body.length < 10) return null;
    const readText = body.slice(0, 4000);
    const cap = String(caption || "").trim();
    const fname = String(filename || "").trim();

    const raw = await callClaude(env, "내용:\n" + readText, EXTRACT_SYSTEM, MODEL_FAST, 500);

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
      decision: normalizeDecision(parsed.decision),
      source: normalizeSource(parsed.source),
    };

    if (!base.schedule && !base.category && !base.summary) return null;

    const matchText = cap + " " + fname + " " + body;
    let projects = [];
    const keywords = await loadProjectKeywords(env);
    if (keywords && body.length >= 10) projects = matchProjects(keywords, cap, fname, body);

    const followup = detectFollowup(matchText);
    const isDone = detectDone(matchText);
    const urgent = detectUrgent(matchText);
    const summary = (urgent ? "[보고요망] " : "") + base.summary;
    const meta = parseInfoMeta(body, sender, receivedAt);

    for (const project of projects) {
      if (project && isDone) {
        try { await updateInsightDone(env, project); } catch (e) { console.error("updateInsightDone error", e && e.message); }
      }
      await insertInsight(env, {
        chatId,
        sourceType: sourceType || "",
        sourceRef,
        schedule: base.schedule,
        category: base.category,
        project,
        summary,
        people: base.people,
        sender,
        inputChars: body.length,
        readChars: readText.length,
        followup,
        done: isDone,
        decision: base.decision,
        source: base.source,
      });
    }

    if (base.category && looksLikeInfoText(body, base.category)) {
      await insertInsight(env, {
        chatId,
        sourceType: "info",
        sourceRef,
        schedule: base.schedule,
        category: base.category,
        project: "",
        summary,
        people: base.people,
        sender,
        inputChars: body.length,
        readChars: readText.length,
        decision: base.decision,
        source: base.source,
        author: meta.author,
        reportDate: meta.reportDate,
      });
    }

    if (!projects.length && !base.category) {
      await insertInsight(env, {
        chatId,
        sourceType: sourceType || "",
        sourceRef,
        schedule: base.schedule,
        category: "",
        project: "",
        summary,
        people: base.people,
        sender,
        inputChars: body.length,
        readChars: readText.length,
        decision: base.decision,
        source: base.source,
      });
    }

    console.log("insight saved:", (projects.join(",") || base.category || "general"), base.summary.slice(0, 30));
    return { ...base, projects, followup, done: isDone, urgent };
  } catch (e) {
    console.error("extractInsight error", e && (e.stack || e.message) || e);
    return null;
  }
}
