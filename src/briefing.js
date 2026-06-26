// briefing.js - morning briefing, /brief, and contact briefing.

import { getMessagesSince, getRecentEngagements, getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART, MODEL_FAST } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { stripHtml, oneLine, issueDate, issueScore, senderTag } from "./utils.js";

const SEPARATOR = "─────";
const INFO_CATEGORIES = ["정부", "국회", "BH", "글로벌", "언론", "경쟁사"];
const INTERNAL_PERSON_RE = /염성진|윤풍영|SK그룹 의장|커뮤니케이션위원장|SK그룹|SKHY|SKALA|Hy-Five|해당 사장|TF 총괄|Steering Committee|작의장|CR팀|미래전략/;
const EXTERNAL_AFFIL_RE = /장관|차관|고용노동부|산업통상자원부|산업부|과기부|정부|국회|의원|BH|대통령|총리|비서실|수석|CEO|해외|글로벌/;
const CHATTER_RE = /^(안녕하세요|감사합니다|네|넵|오 |아 |음|제가 |저장을|따로|보내주신|일정도|최근|여기까지|잘 |좋|맞아요|이해를|가능|\/|@)/;
const BOT_OUTPUT_RE = /^(📊|🗞|📂|📋|🪪|📄|요약할 내용|권한이 없습니다|현재 제공|안녕하세요\. 무엇을)/;
const ISSUE_RE = /보고|결정|확인|승인|검토|면담|간담회|발표|준비|토킹포인트|회의|일정|변경|공유|요청|주재|방침|추진|계획|자료/;
const DECISION_RE = /사장님|결정|확정|승인|확인 필요|보고요망|보고 필요|보내주세요|대응 방침|요청|준비 필요|검토 필요|발표내용/;
const REPORT_RE = /보고|발표|준비|토킹포인트|연설|간담회|행사|O\/I|TF|추진 현황|운영계획|보고드립니다|발표자료|아젠다/;

const BRIEF_SYSTEM = PERSONA_STYLE + "\n\n" +
  "당신은 염성진 사장의 당일 업무 브리핑 비서다. 입력은 최근 공유된 사내 보고자료, 프로젝트 자료, 대외정보, 회의록 원문이다.\n\n" +
  "[핵심 역할]\n" +
  "- /brief는 뉴스 요약이 아니다. 사장이 오늘/곧 챙겨야 할 업무만 뽑는다.\n" +
  "- 저장된 summary 첫 줄을 베끼지 말고, 원문 전체를 읽어 사장 보고용 1줄로 다시 쓴다.\n" +
  "- 표지문, 목차, 'For Discussion Purpose Only', '사장님.' 같은 껍데기 문구는 버린다.\n\n" +
  "[섹션 정의]\n" +
  "1) 결정·확인 필요\n" +
  "- 사장이 직접 판단·승인·확인해야 하는 항목만. 단순 정보/뉴스/토의용 자료는 넣지 않는다.\n" +
  "- '검토중', '토의용', 'For Discussion Purpose Only'는 결정이 아니다. 확인 필요가 명시되지 않으면 제외한다.\n\n" +
  "2) 만남 (외부)\n" +
  "- 외부 인사와의 실제/예정 면담·간담회·미팅만.\n" +
  "- 사내 인물, 문서 속 언급 인물, 뉴스 속 인물은 제외한다.\n\n" +
  "3) 보고 건\n" +
  "- 사내 보고자료 또는 사장이 준비해서 말해야 하는 발표·회의·행사 보고.\n" +
  "- O/I, TF, CR, AX, 운영계획, 추진 현황, 발표자료는 이 섹션에 넣는다.\n" +
  "- 형식 예: • [6/24] O/I 보고 자료 — CR 지원팀 입법 패키지·AX 운영계획·추진 일정 포함\n" +
  "- 발신자 이름·약칭은 쓰지 않는다.\n" +
  "- '[내부]/[외부]' 태그는 붙이지 않는다.\n\n" +
  "[날짜]\n" +
  "- 날짜는 앞으로 예정된 사안일을 우선한다. 원문에 없으면 created 날짜를 쓰되, 이상한 날짜(30/0, 31/4)는 쓰지 않는다.\n" +
  "- 25/6처럼 일/월로 보이면 6/25로 고친다.\n\n" +
  "[출력]\n" +
  "- 아래 양식만 출력. 없는 섹션은 '• 없음' 한 줄.\n" +
  "- 각 항목은 1줄, 90자 안팎. 내용이 메인이다.\n" +
  "- 굵게는 HTML <b>만 사용. 마크다운 ** 금지.\n" +
  "- 발신자 이름·약칭(SY, Yeom 등) 표기 금지. 중복 내용 병합. 구분선은 ─────만 사용. 불릿(•) 한 단계.\n\n" +
  "업무 브리핑 · {오늘}\n" +
  "<b>[결정·확인 필요]</b>\n" +
  "• [M/D] {사장이 결정/확인할 내용}\n\n" +
  "<b>[만남(외부)]</b>\n" +
  "• [M/D] <b>{외부 인물}</b> {소속/직책} — {만남 목적}\n\n" +
  "<b>[보고 건]</b>\n" +
  "• [M/D] {보고자료명/회의명} — {핵심 내용 2~3개 압축}\n" +
  "대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief";

const MORNING_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 지난 하루 대화를 읽고 사장이 출근길 30초에 파악하도록 정리. 각 항목 1줄.\n" +
  "날짜·사람·안건은 <b>굵게</b>. 해당 없는 분류는 생략.\n" +
  "발신자 이름·약칭(SY, Yeom 등) 표기 금지. 중복 내용 병합. 구분선은 ─────만 사용. 불릿(•) 한 단계.\n" +
  "출력 형식:\n\n" +
  "🗞 <b>아침 브리핑</b>\n\n" +
  "📅 일정\n• 1줄\n\n" +
  "⚖️ 의사결정\n• 1줄\n\n" +
  "📌 주요 내용\n• 1줄";

const CONTACT_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 최근 사장이 만난 사람과 나눈 내용을 정리. 미사여구 금지.\n" +
  "각 줄: • <b>[날짜]</b> <u>이름(소속)</u> — 주제 핵심 1줄\n" +
  "출력 형식:\n\n" +
  "🤝 <b>면담 이력</b>\n\n" +
  "• <b>[날짜]</b> <u>이름(소속)</u> — 핵심";

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayText() {
  const d = new Date();
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function textOf(row) {
  return String(row.schedule || "") + " " + String(row.summary || "") + " " + String(row.people || "");
}

function isUsefulRow(row) {
  const sender = String(row.sender || "");
  const summary = stripHtml(row.summary || "");
  if (!summary || summary.length < 8) return false;
  if (sender === "Yeom agent") return false;
  if (CHATTER_RE.test(summary)) return false;
  if (BOT_OUTPUT_RE.test(summary)) return false;
  return ISSUE_RE.test(textOf(row));
}

function isOI(row) {
  return /O\/I|내부 보고|운영계획|추진 현황 보고|TF 보고/.test(textOf(row));
}

function externalPeople(row) {
  const chunks = String(row.people || "")
    .split(/[,/·\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  const out = [];
  for (const chunk of chunks) {
    if (INTERNAL_PERSON_RE.test(chunk)) continue;
    if (!EXTERNAL_AFFIL_RE.test(chunk)) continue;
    if (out.indexOf(chunk) === -1) out.push(chunk);
  }
  return out;
}

function isMeetingRow(row) {
  if (!INFO_CATEGORIES.includes(row.category)) return false;
  if (isOI(row)) return false;
  if (!/면담|미팅|간담회|환담|오찬|회의/.test(textOf(row))) return false;
  return externalPeople(row).length > 0;
}

function isDecisionRow(row) {
  if (!isUsefulRow(row)) return false;
  if (isOI(row)) return false;
  return DECISION_RE.test(textOf(row));
}

function isReportRow(row) {
  if (!isUsefulRow(row) && !isOI(row)) return false;
  return isOI(row) || REPORT_RE.test(textOf(row));
}

function byImminence(a, b) {
  const now = new Date();
  const today = (now.getMonth() + 1) * 100 + now.getDate();
  return Math.abs(issueScore(a) - today) - Math.abs(issueScore(b) - today);
}

function isTodayOrFuture(row) {
  const score = issueScore(row);
  const now = new Date();
  const today = (now.getMonth() + 1) * 100 + now.getDate();
  return score !== 9999 && score >= today;
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [
      row.source_ref || "",
      stripHtml(row.summary || "").replace(/\s+/g, "").slice(0, 80),
      row.sender || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function displaySender(row) {
  const raw = String(row.sender || row.author || "").replace(/\s+/g, " ").trim();
  if (!raw) return "—";
  return (raw.split(" ")[0] || raw).slice(0, 20);
}

function sourceText(row) {
  return stripHtml(row.raw_message || row.raw_file || row.summary || "").trim();
}

function buildBriefPrompt(rows) {
  const blocks = rows.slice(0, 18).map(function (row, idx) {
    return [
      "[자료 " + (idx + 1) + "]",
      "분류: " + (row.project ? "프로젝트:" + row.project : (row.category || "")),
      "사안일힌트: " + issueDate(row),
      "공유자: " + displaySender(row),
      "인물힌트: " + stripHtml(row.people || ""),
      "저장요약: " + stripHtml(row.summary || ""),
      "원문:",
      sourceText(row).slice(0, 500),
    ].join("\n");
  });
  return "오늘: " + todayText() + "\n\n" + blocks.join("\n\n---\n\n");
}

function cleanBriefOutput(text) {
  const out = String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
  if (!out.includes("브리핑") || !out.includes("[보고 건]")) return "";
  return out;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message || "timeout")); }, ms);
    }),
  ]);
}

async function sendLongMessage(env, chatId, text) {
  const limit = 3500;
  const parts = [];
  let rest = String(text || "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < 1000) cut = rest.lastIndexOf("\n", limit);
    if (cut < 1000) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  for (const part of parts) await sendMessage(env, chatId, part);
}

export async function runMorningBriefing(env, replyChatId) {
  const chatIds = (env.BRIEFING_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!chatIds.length) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await getMessagesSince(env, chatIds, since);
  if (!rows.length) return;
  const digest = rows.map((r) => `[${r.sender}] ${r.text}`).join("\n");
  const summary = await callClaude(env, "지난 하루 대화:\n" + digest, MORNING_SYSTEM, MODEL_SMART, 1500);
  const target = replyChatId || env.BRIEFING_TARGET_ID || chatIds[0];
  await sendMessage(env, target, summary);
}

export async function runBrief(env, chatId) {
  const infoRows = (await getInsightsSince(env, sinceDaysIso(2), { categoryIn: INFO_CATEGORIES, projectEmpty: true })) || [];
  const projRows = (await getInsightsSince(env, sinceDaysIso(14), { projectNotEmpty: true })) || [];
  const internalRows = ((await getInsightsSince(env, sinceDaysIso(7), { projectEmpty: true })) || [])
    .filter(function (r) { return r.category === "내부" || isOI(r); });

  const workRows = internalRows.concat(projRows);
  const sourceRows = uniqueRows(workRows.concat(infoRows))
    .filter(function (r) { return isUsefulRow(r) || isOI(r) || isMeetingRow(r) || /O\/I|OI|CR|AX|TF|보고|발표자료|운영계획|추진 현황/.test(sourceText(r)); })
    .sort(byImminence);

  if (sourceRows.length) {
    try {
      const composed = cleanBriefOutput(await withTimeout(
        callClaude(env, buildBriefPrompt(sourceRows), BRIEF_SYSTEM, MODEL_FAST, 2000),
        25000,
        "brief compose timeout"
      ));
      if (composed) return sendLongMessage(env, chatId, composed);
    } catch (e) {
      console.error("compose brief error", e && e.message);
    }
  }

  const decisions = uniqueRows(workRows.filter(isDecisionRow).filter(isTodayOrFuture)).sort(byImminence).slice(0, 5);
  const meetings = uniqueRows(infoRows.filter(isMeetingRow).filter(isTodayOrFuture)).sort(byImminence).slice(0, 4);
  const reports = uniqueRows(workRows.filter(isReportRow).filter(isTodayOrFuture)).sort(byImminence).slice(0, 5);

  const lines = ["업무 브리핑 · " + todayText(), SEPARATOR, ""];
  lines.push("<b>[결정·확인 필요]</b>");
  if (decisions.length) {
    for (const row of decisions) lines.push("• [" + issueDate(row) + "] " + oneLine(row.summary) + senderTag(row));
  } else {
    lines.push("• 임박한 결정·확인 필요 건 없음");
  }
  lines.push("");

  lines.push("<b>[만남(외부)]</b>");
  if (meetings.length) {
    for (const row of meetings) {
      const people = externalPeople(row).map(function (p) { return "<b>" + p + "</b>"; }).join(" · ");
      lines.push("• " + people + " (" + issueDate(row) + ")");
    }
  } else {
    lines.push("• 임박한 외부 만남 없음");
  }
  lines.push("");

  lines.push("<b>[보고 건]</b>");
  if (reports.length) {
    for (const row of reports) lines.push("• [" + issueDate(row) + "] " + oneLine(row.summary) + senderTag(row));
  } else {
    lines.push("• 임박한 보고 건 없음");
  }
  lines.push("");
  lines.push(SEPARATOR);
  lines.push("대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief");

  await sendLongMessage(env, chatId, lines.join("\n"));
}

export async function runBriefAuto(env) {
  const targets = String(env.BRIEFING_TARGET_ID || "").split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  for (const id of targets) {
    try { await runBrief(env, id); }
    catch (e) { console.error("runBriefAuto", e && e.message); }
  }
}

export async function runContactBriefing(env, chatId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getRecentEngagements(env, since);
  if (!rows.length) {
    return sendMessage(env, chatId, "최근 " + days + "일간 기록된 면담이 없습니다.");
  }
  const digest = rows.map((r) => `${r.met_at} ${r.name || "?"}(${r.org || ""}) ${r.topic} ${r.summary}`).join("\n");
  const summary = await callClaude(env, "면담 기록:\n" + digest, CONTACT_SYSTEM, MODEL_SMART, 1200);
  await sendMessage(env, chatId, summary);
}
