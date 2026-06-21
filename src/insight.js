// insight.js - content-time structured extraction into insights.
// source_type is the input path (file/message/etc). project/category are mutually separated.

import { callClaude, MODEL_FAST } from "./claude.js";
import { getProjectKeywords, updateInsightDone } from "./db.js";

const INFO_CATEGORIES = ["정부", "국회", "BH", "글로벌", "언론"];

const EXTRACT_SYSTEM = `당신은 염성진 사장 자료 분류 비서다.
JSON만 반환하라. 마크다운 금지.

[분류 규칙]
1. 자료 성격을 먼저 판정:
   - 프로젝트 추진 문서(nexus 등) → project=프로젝트명, category 비움
   - 대외정보(외부 정세·대면 활동) → category=5개 중 하나, project 비움
   - 내부 보고/운영계획(O/I 등) → category·project 모두 비움
2. category는 5개만(그 외·임의생성 금지): 정부 / 국회 / BH / 글로벌 / 언론
   - "정책"·"언론PR" 쓰지 말 것 → 정부·언론으로.
3. 대면 활동도 대외정보다. 만난 상대 소속으로 category 분류(정부 인사 면담→정부).
4. project는 nexus/넥서스 표기를 'nexus'로 통일.
5. 없는 값은 빈 문자열(''). 추론·창작 금지.

[결정/출처]
decision·followup 컬럼은 사용하지 않는다. 결정사항은 summary에 문서가 명시한 내용만 짧게 포함한다.

스키마:
{
  "kind": "project | info | internal",
  "category": "정부, 국회, BH, 글로벌, 언론 중 하나. kind가 info가 아니면 빈 문자열",
  "project": "프로젝트명. nexus/넥서스는 nexus. kind가 project가 아니면 빈 문자열",
  "schedule": "날짜+안건. 없으면 빈 문자열",
  "summary": "핵심 1~2줄",
  "people": "관련 인물/소속. 없으면 빈 문자열"
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
      const project = normalizeProject(row.project);
      if (project === "PR 중요기사") {
        if (capLower.indexOf("pr중요기사") === 0 && hit.indexOf(project) === -1) hit.push(project);
        continue;
      }
      if (src.indexOf(kw) !== -1 && hit.indexOf(project) === -1) hit.push(project);
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
  if (raw === "정책") return "정부";
  if (raw === "대통령실") return "BH";
  if (raw === "언론PR" || raw === "언론홍보" || raw === "PR") return "언론";
  for (const category of INFO_CATEGORIES) {
    if (raw === category || raw.indexOf(category) !== -1) return category;
  }
  return "";
}

export function normalizeProject(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^nexus$/i.test(raw) || raw === "넥서스") return "nexus";
  return raw;
}

export function normalizeDecision() {
  return "";
}

export function normalizeSource() {
  return "";
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

async function insertInsight(env, row) {
  await env.DB.prepare(
    `INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars, author, report_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

    const matchText = cap + " " + fname + " " + body;
    const keywords = await loadProjectKeywords(env);
    const matchedProjects = keywords ? matchProjects(keywords, cap, fname, body) : [];
    const llmProject = normalizeProject(parsed.project);
    const projects = matchedProjects.length ? matchedProjects : (llmProject ? [llmProject] : []);
    const kind = String(parsed.kind || "").trim();
    const isProject = projects.length || kind === "project";
    const category = isProject ? "" : normalizeCategory(parsed.category);
    const project = isProject ? (projects[0] || llmProject) : "";
    const summary = (detectUrgent(matchText) ? "[보고요망] " : "") + String(parsed.summary || "").trim();
    const meta = parseInfoMeta(body, sender, receivedAt);

    if (!summary && !category && !project) return null;
    if (project && detectDone(matchText)) {
      try { await updateInsightDone(env, project); } catch (e) { console.error("updateInsightDone error", e && e.message); }
    }

    await insertInsight(env, {
      chatId,
      sourceType: sourceType || "",
      sourceRef,
      schedule: String(parsed.schedule || "").trim(),
      category,
      project,
      summary,
      people: String(parsed.people || "").trim(),
      sender,
      inputChars: body.length,
      readChars: readText.length,
      author: category ? meta.author : null,
      reportDate: category ? meta.reportDate : null,
    });

    console.log("insight saved:", project || category || "general", summary.slice(0, 30));
    return { schedule: parsed.schedule || "", category, project, summary, people: parsed.people || "" };
  } catch (e) {
    console.error("extractInsight error", e && (e.stack || e.message) || e);
    return null;
  }
}
