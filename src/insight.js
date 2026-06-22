// insight.js - content-time structured extraction into insights.
// source_type is the input path (file/message/etc). project/category are mutually separated.

import { callClaude, MODEL_FAST } from "./claude.js";
import { getProjectKeywords, updateInsightDone } from "./db.js";
import { stripSalutation } from "./utils.js";

const INFO_CATEGORIES = ["정부", "국회", "BH", "글로벌", "언론", "내부", "기타"];

const EXTRACT_SYSTEM = `당신은 염성진 사장 자료 분류 비서다.
JSON만 반환하라. 마크다운 금지.

[분류 규칙]
1. 자료 성격을 먼저 판정:
   - 아래 [등록된 프로젝트] 중 하나에 관한 자료 → project=그 프로젝트명, category 비움
     (키워드가 정확히 안 보여도 내용 맥락이 그 프로젝트면 그 프로젝트로 분류한다)
   - 어느 프로젝트에도 안 맞는 대외정보(외부 정세·대면 활동) → category=7개 중 하나, project 비움
   - 내부 보고/운영계획(O/I 등) → category=내부, project 비움
2. category는 7개 중 하나로 반드시 채운다(빈 값 금지): 정부 / 국회 / BH / 글로벌 / 언론 / 내부 / 기타
   - 내부: 사내 발언·회의·타운홀·운영계획·조직문화 등 내부 자료
   - 기타: 위 6개 어디에도 안 맞을 때만 (최후의 보루, 남발 금지)
   - "정책"·"언론PR" 쓰지 말 것 → 정부·언론으로.
3. 대면 활동도 대외정보다. 만난 상대 소속으로 category 분류(정부 인사 면담→정부).
4. project는 nexus/넥서스 표기를 'nexus'로 통일.
5. 없는 값은 빈 문자열(''). 추론·창작 금지.

[결정/출처]
decision·followup 컬럼은 사용하지 않는다. 결정사항은 summary에 문서가 명시한 내용만 짧게 포함한다.

스키마:
{
  "kind": "project | info | internal",
  "category": "정부, 국회, BH, 글로벌, 언론, 내부, 기타 중 하나. 반드시 채운다(빈 값 금지). kind가 project면 빈 문자열",
  "project": "프로젝트명. nexus/넥서스는 nexus. kind가 project가 아니면 빈 문자열",
  "schedule": "날짜+안건. 없으면 빈 문자열",
  "summary": "핵심을 구체적으로 담은 1줄(50~70자). 본문에 있는 구체값(금액·숫자·대상·일시·장소·참석자·기관명)을 반드시 포함해 '무엇을 누가 얼마/언제'가 드러나게. 막연한 표현('지원 내용 발표', '과제 보고') 금지 — 본문에 구체 내용이 있으면 그것을 요약하고, 본문에도 없으면 '(내용 확인 필요)'로 표기. 인사말('사장님' 등 호칭)·머리표·불릿·이모지·제목 형식 금지. '사장님'으로 시작 금지.",
  "people": "관련 인물·소속을 최대한 구체적으로(이름+직책/소속). 대면·면담·발언 자료는 누가 등장하는지 반드시 추출. 없으면 빈 문자열"
}`;

// 등록된 프로젝트 목록을 LLM 프롬프트용 힌트로. 프로젝트명 + 키워드 예시.
// 분류기가 사용자의 프로젝트를 맥락으로 인식하게 한다(키워드 정확 일치 없어도).
export function projectHints(keywords) {
  if (!keywords || !keywords.length) return "";
  const map = {};
  for (const r of keywords) {
    const p = normalizeProject(r.project);
    if (!p) continue;
    if (!map[p]) map[p] = [];
    if (r.keyword && map[p].indexOf(r.keyword) === -1) map[p].push(r.keyword);
  }
  const names = Object.keys(map);
  if (!names.length) return "";
  const lines = names.map(function (p) {
    const ex = map[p].slice(0, 6);
    return "- " + p + (ex.length ? " (예: " + ex.join(", ") + ")" : "");
  });
  return "\n\n[등록된 프로젝트]\n" + lines.join("\n");
}

export async function loadProjectKeywords(env) {
  try {
    return await getProjectKeywords(env);
  } catch (e) {
    console.error("loadProjectKeywords error", e && e.message);
    return null;
  }
}

// 본문(문서 내용)에는 우연한 단어가 많아, 너무 짧은 키워드(예: "용인")는 무관한 문서를
// 잘못 끌어온다. 공백·하이픈 제거 후 길이로 판단한다.
function compactLen(kw) {
  return String(kw || "").replace(/[\s\-]/g, "").length;
}

// 캡션에서 #해시태그 추출 (#넥서스, #용인 ...)
function captionTags(caption) {
  const out = [];
  const re = /#([0-9A-Za-z가-힣_]+)/g;
  let m;
  while ((m = re.exec(String(caption || ""))) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

// 태그를 등록 프로젝트로 해석: (1) 프로젝트명 일치 (2) 키워드 포함. 없으면 빈 문자열.
function resolveTag(keywords, tag) {
  const t = String(tag || "").toLowerCase();
  if (!t) return "";
  for (const row of (keywords || [])) {
    if (normalizeProject(row.project).toLowerCase() === t) return normalizeProject(row.project);
  }
  for (const row of (keywords || [])) {
    const kw = String(row.keyword || "").toLowerCase();
    if (kw && t.indexOf(kw) !== -1) return normalizeProject(row.project);
  }
  return "";
}

// 캡션 해시태그 → 프로젝트(분류 최우선). 등록 안 된 태그는 그 이름 그대로 폴더로 사용.
export function captionProject(keywords, caption) {
  const tags = captionTags(caption);
  for (const tag of tags) {
    const proj = resolveTag(keywords, tag);
    if (proj) return proj;
  }
  return tags.length ? tags[0] : "";
}

export function matchProjects(keywords, caption, filename, body) {
  const cap = String(caption || "");
  const capLower = cap.toLowerCase();

  // 1) 캡션 #해시태그 — 공유자가 직접 지정한 분류이므로 최우선.
  const tagProj = captionProject(keywords, cap);
  if (tagProj) return [tagProj];

  if (!keywords || !keywords.length) {
    return capLower.indexOf("pr중요기사") === 0 ? ["PR 중요기사"] : [];
  }

  // 2) 캡션 → 3) 파일명 → 4) 본문 순. 본문은 3자 이상 키워드만(짧은 지명 오탐 차단).
  const tiers = [
    { src: capLower, body: false },
    { src: String(filename || "").toLowerCase(), body: false },
    { src: String(body || "").toLowerCase(), body: true },
  ];
  for (const tier of tiers) {
    if (!tier.src) continue;
    const hit = [];
    for (const row of keywords) {
      const kw = String(row.keyword || "").toLowerCase();
      if (!kw) continue;
      if (tier.body && compactLen(kw) <= 2) continue; // 본문에서는 2자 이하 키워드 무시
      const project = normalizeProject(row.project);
      if (project === "PR 중요기사") {
        if (capLower.indexOf("pr중요기사") === 0 && hit.indexOf(project) === -1) hit.push(project);
        continue;
      }
      if (tier.src.indexOf(kw) !== -1 && hit.indexOf(project) === -1) hit.push(project);
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

const INFO_KEYWORD_RULES = [
  { category: "BH", re: /BH|대통령실|대통령|국정상황실|정무수석|비서실장|수석비서관|총리|인선/ },
  { category: "언론", re: /언론|기사|보도|취재|기자|인터뷰|PR|홍보|광고|방송|유튜브|타임스퀘어|CNBC|블룸버그TV|로이터|워싱턴포스트|중앙일보|조선일보|미디어/ },
  { category: "글로벌", re: /글로벌|해외|외신|미국|중국|일본|대만|EU|유럽|워싱턴|뉴욕|통상|관세|수출규제|상무부|ASML|NVIDIA|Microsoft|AWS|Anthropic|Micron|CXMT|UNEP|GGGI|나스닥|ADR/ },
  { category: "국회", re: /국회|의원실|국회의원|상임위|법안|정당|민주당|국민의힘|정책위의장|입법|보좌관|국회법/ },
  { category: "정부", re: /정부|장관|차관|부처|산업부|산업통상자원부|고용노동부|고용부|기후부|환경부|공정위|공정거래위원회|과기부|국토부|교육부|규제기관|인수위|도지사|시장|산단|클러스터|정책|규제/ },
];

export function classifyInfoCategory(text, fallback) {
  const normalized = normalizeCategory(fallback);
  if (normalized && normalized !== "기타" && normalized !== "내부") return normalized;
  const body = String(text || "");
  if (/O\/I|OI|티미팅|회의체|위클리|내부 보고|운영계획|조직문화|Comm\.?\s*위|커뮤니케이션총괄/.test(body)) return "내부";
  for (const rule of INFO_KEYWORD_RULES) {
    if (rule.re.test(body)) return rule.category;
  }
  return normalized || "기타";
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

// sender_id 컬럼 마이그레이션은 워커 인스턴스당 한 번만 시도(매 INSERT 마다 ALTER 방지).
let senderIdReady = false;
async function ensureSenderIdColumn(env) {
  if (senderIdReady) return;
  try { await env.DB.prepare("ALTER TABLE insights ADD COLUMN sender_id TEXT DEFAULT ''").run(); } catch (e) { /* 이미 있으면 무시 */ }
  senderIdReady = true;
}

async function insertInsight(env, row) {
  await ensureSenderIdColumn(env);
  await env.DB.prepare(
    `INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, sender_id, input_chars, read_chars, author, report_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    row.sender_id || "",
    row.inputChars || 0,
    row.readChars || 0,
    row.author || null,
    row.reportDate || null
  ).run();
}

// 저장된 파일을 다시 분류한다(재분류용). 키워드로 프로젝트가 잡히면 LLM 호출 없이 끝.
// 안 잡힐 때만 LLM 으로 kind/category/project 를 판정. insights 테이블에는 쓰지 않는다.
export async function classifyStored(env, { text, filename, caption }) {
  const body = String(text || "").trim();
  const keywords = await loadProjectKeywords(env);
  const matched = matchProjects(keywords, caption || "", filename || "", body);
  if (matched.length) return { project: matched[0], category: "" };
  if (body.length < 10) return { project: "", category: "" };
  let parsed;
  try {
    const raw = await callClaude(env, "내용:\n" + body.slice(0, 4000), EXTRACT_SYSTEM + projectHints(keywords), MODEL_FAST, 500);
    parsed = JSON.parse(cleanJson(raw));
  } catch (e) {
    console.error("classifyStored parse error", e && e.message);
    return { project: "", category: "" };
  }
  const llmProject = normalizeProject(parsed.project);
  const isProject = !!llmProject || String(parsed.kind || "").trim() === "project";
  return {
    project: isProject ? llmProject : "",
    category: isProject ? "" : classifyInfoCategory(body, parsed.category),
  };
}

// 기존 항목 재요약: 원문(text)을 다시 읽어 개선된 프롬프트로 summary/people/schedule 만 새로 만든다.
// 분류(project/category)는 건드리지 않는다. 실패 시 null.
export async function resummarizeText(env, text) {
  const body = String(text || "").trim();
  if (body.length < 20) return null;
  const keywords = await loadProjectKeywords(env);
  let parsed;
  try {
    const raw = await callClaude(env, "내용:\n" + body.slice(0, 6000), EXTRACT_SYSTEM + projectHints(keywords), MODEL_FAST, 500);
    parsed = JSON.parse(cleanJson(raw));
  } catch (e) {
    console.error("resummarizeText parse error", e && e.message);
    return null;
  }
  let summary = stripSalutation(String(parsed.summary || "").trim()
    .replace(/^\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, ""));
  if (!summary) {
    summary = stripSalutation(String(body).replace(/<\/?[a-zA-Z]+>/g, "").trim())
      .split(/(?<=[.!?。]|다\.|임\.|음\.)\s+/u)[0].slice(0, 80).trim();
  }
  if (!summary) return null;
  return {
    summary,
    people: String(parsed.people || "").trim(),
    schedule: String(parsed.schedule || "").trim(),
  };
}

export async function extractInsight(env, { chatId, sourceType, sourceRef, text, sender, senderId, caption, filename, receivedAt }) {
  try {
    const body = String(text || "").trim();
    if (body.length < 10) return null;
    const readText = body.slice(0, 4000);
    const cap = String(caption || "").trim();
    const fname = String(filename || "").trim();

    // 등록 프로젝트 목록을 프롬프트에 주입해 LLM 이 맥락으로 프로젝트를 인식하게 한다.
    const keywords = await loadProjectKeywords(env);
    const raw = await callClaude(env, "내용:\n" + readText, EXTRACT_SYSTEM + projectHints(keywords), MODEL_FAST, 500);
    let parsed;
    try {
      parsed = JSON.parse(cleanJson(raw));
    } catch (e) {
      console.error("insight parse error", e && e.message);
      // 파싱 실패해도 원문 첫 문장 + 기타로 저장 (자료 유실 방지)
      parsed = {
        kind: "info",
        category: "기타",
        project: "",
        schedule: "",
        summary: String(body || "").replace(/<\/?[a-zA-Z]+>/g, "").slice(0, 60).trim(),
        people: ""
      };
    }

    const matchText = cap + " " + fname + " " + body;
    const matchedProjects = keywords ? matchProjects(keywords, cap, fname, body) : [];
    const llmProject = normalizeProject(parsed.project);
    const projects = matchedProjects.length ? matchedProjects : (llmProject ? [llmProject] : []);
    const kind = String(parsed.kind || "").trim();
    const isProject = projects.length || kind === "project";
    // project면 category 공란(프로젝트로 분류됨), 아니면 반드시 7개 중 하나 — 비면 "기타".
    const category = isProject ? "" : classifyInfoCategory(matchText, parsed.category);
    const project = isProject ? (projects[0] || llmProject) : "";
    // 머리표("[보고요망]" 등)·인사말("사장님" 등)을 summary 본문에 박지 않는다.
    let summary = stripSalutation(String(parsed.summary || "").trim()
      .replace(/^\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, ""));
    if (!summary) {
      // LLM 요약 실패 시 원문에서 인사말을 떼고 첫 문장을 정제해 사용
      summary = stripSalutation(String(body || "")
        .replace(/<\/?[a-zA-Z]+>/g, "")
        .replace(/^\[(보고요망|보고|공유|참고|검토)\]\s*/g, "")
        .trim())
        .split(/(?<=[.!?。]|다\.|임\.|음\.)\s+/u)[0]
        .slice(0, 60)
        .trim();
    }
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
      sender_id: senderId || "",
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
