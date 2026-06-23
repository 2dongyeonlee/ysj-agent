// info.js - external-affairs briefing from categorized insights.

import { getInfoInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";
import { oneLine, issueDate, issueScore, senderTag, peopleText, stripHtml } from "./utils.js";
import { callClaude, MODEL_SMART } from "./claude.js";

function recentFirst(a, b) {
  const sa = issueScore(a), sb = issueScore(b);
  const ua = sa === 9999, ub = sb === 9999;
  if (ua !== ub) return ua ? 1 : -1;
  return sb - sa;
}

const INFO_CATEGORIES = [
  { name: "정부", icon: "" },
  { name: "BH", icon: "" },
  { name: "국회", icon: "" },
  { name: "언론", icon: "" },
  { name: "글로벌", icon: "" },
  { name: "경쟁사", icon: "" },
];

const SEPARATOR = "━━━━━━━━━";
const INFO_SYSTEM = `당신은 염성진 사장에게 대외정보를 보고하는 비서다.
입력은 여러 사람이 공유한 DM·파일·회의록 원문이다. 저장된 summary 앞부분을 베끼지 말고, 원문에서 사장에게 보고할 "안건"을 뽑아 한 줄 보고문으로 다시 작성하라.

[절대 원칙]
- 원문 하나에 여러 안건이 있으면 안건별로 분리한다.
- 각 안건은 1줄만 쓴다. 제목·목차·"1."·"Ⅱ."·문서 앞머리 복붙 금지.
- 사람이 만난 내용, 면담 참고자료, 회의록, 정책/언론 동향을 모두 "사장에게 공유된 대외정보" 관점으로 정리한다.
- 날짜는 원문에 명시된 사안일만 쓴다. 25/6처럼 일/월이면 6/25로 고친다. 30/0처럼 불가능한 날짜는 쓰지 말고 입력의 created 날짜 또는 "—"를 쓴다.
- 분류는 정부 / BH / 국회 / 언론 / 글로벌 / 경쟁사 6개만 쓴다. 기타·내부 생성 금지.
- 출력은 아래 양식만. 설명, 사족, 마크다운 ** 금지. 굵게는 HTML <b>만 사용.
- 각 항목 끝에는 반드시 (공유자) 를 붙인다.
- 각 카테고리 안에서 당사 직접 영향 건을 위로, 단순 인지 건은 끝에 "— 인지 수준"으로 짧게 쓴다.
- 부등호(<, >)를 본문에 쓰지 말 것. "이상/이하/초과/미만"으로 표기한다.

[분류 기준]
- 정부: 장관·차관·부처·공정위·산업부·고용부·기후부·지자체·규제기관
- BH: 대통령·대통령실·정무수석·국정상황실·비서실장·총리·인선
- 글로벌: 해외 정부/기업/정책, 미국·중국·일본·대만·EU, ASML·NVIDIA·Anthropic 등
- 국회: 의원실·의원·정당·상임위·법안·입법·정책위
- 언론: 기자·기사·보도·인터뷰·광고·PR·방송·미디어 대응
- 경쟁사: 삼성·B社·C社·파운드리·테슬라·평택 P5·용인클러스터 인력·HBM 경쟁/추격 등 당사 경쟁 동향

[출력 양식]
대외정보 · {오늘}
━━━━━━━━━

<b>[정부]</b>
• [M/D] {안건 1줄} ({공유자})

<b>[BH]</b>
• [M/D] {안건 1줄} ({공유자})

<b>[국회]</b>
• [M/D] {안건 1줄} ({공유자})

<b>[언론]</b>
• [M/D] {안건 1줄} ({공유자})

<b>[글로벌]</b>
• [M/D] {안건 1줄} ({공유자})

<b>[경쟁사]</b>
• [M/D] {안건 1줄} ({공유자})

━━━━━━━━━
프로젝트 /project · 핵심 /brief`;
const STOPWORDS = new Set([
  "보고요망", "관련", "통해", "대한", "대해", "하며", "하고", "있다", "있음", "중임",
  "필요", "강화", "추진", "가능성", "상황", "제기", "예정", "자료", "브리핑",
]);

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayText() {
  const d = new Date();
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function displaySender(row) {
  const raw = String(row.sender || row.author || "").replace(/\s+/g, " ").trim();
  if (!raw) return "—";
  return (raw.split(" ")[0] || raw).slice(0, 20);
}

function sourceText(row) {
  return stripHtml(row.raw_message || row.raw_file || row.summary || "").trim();
}

function tokens(row) {
  const text = (stripHtml(row.summary || "") + " " + stripHtml(row.people || ""))
    .replace(/\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, "")
    .replace(/[0-9]+(?:\.[0-9]+)?/g, " ")
    .replace(/[^\p{L}A-Za-z]+/gu, " ")
    .toLowerCase();
  const raw = text.split(/\s+/).filter(function (t) { return t.length >= 2 && !STOPWORDS.has(t); });
  return Array.from(new Set(raw));
}

function sameIssue(a, b) {
  if (a.category !== b.category) return false;
  const da = issueDate(a), db = issueDate(b);
  const sameDate = da === "—" || db === "—" || da === db;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  let common = 0;
  for (const t of ta) if (setB.has(t)) common++;
  const score = common / Math.min(ta.length, tb.length);
  return sameDate ? score >= 0.5 : score >= 0.75;
}

function dedupeIssues(rows) {
  const kept = [];
  for (const row of rows) {
    if (kept.some(function (prev) { return sameIssue(prev, row); })) continue;
    kept.push(row);
  }
  return kept;
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

function buildInfoPrompt(items) {
  const blocks = items.slice(0, 24).map(function (row, idx) {
    const raw = sourceText(row).slice(0, 650);
    return [
      "[자료 " + (idx + 1) + "]",
      "분류힌트: " + (row.category || ""),
      "사안일힌트: " + issueDate(row),
      "공유자: " + displaySender(row),
      "인물힌트: " + stripHtml(row.people || ""),
      "저장요약: " + stripHtml(row.summary || ""),
      "원문:",
      raw,
    ].join("\n");
  });
  return "오늘: " + todayText() + "\n\n" + blocks.join("\n\n---\n\n");
}

function cleanInfoOutput(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

async function composeInfoWithClaude(env, items) {
  const prompt = buildInfoPrompt(items);
  const out = await withTimeout(
    callClaude(env, prompt, INFO_SYSTEM, MODEL_SMART, 2200),
    25000,
    "info compose timeout"
  );
  const cleaned = cleanInfoOutput(out);
  if (!cleaned.includes("대외정보") || !cleaned.includes("━━━━━━━━━")) return "";
  return cleaned;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message || "timeout")); }, ms);
    }),
  ]);
}

export async function runInfoBriefing(env, chatId, days) {
  const rows = await getInfoInsightsSince(env, sinceDaysIso(days || 14), INFO_CATEGORIES.map(function (c) { return c.name; }));
  const items = dedupeIssues((rows || []).filter(function (r) { return r.category && r.summary; }).sort(recentFirst));
  if (!items.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  try {
    const composed = await composeInfoWithClaude(env, items);
    if (composed) {
      if (chatId) {
        await sendLongMessage(env, chatId, composed);
      } else {
        const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        for (const id of targets) await sendLongMessage(env, id, composed);
      }
      return;
    }
  } catch (e) {
    console.error("composeInfoWithClaude error", e && e.message);
  }

  const lines = ["대외정보 · " + todayText(), SEPARATOR, ""];
  for (const cat of INFO_CATEGORIES) {
    const grouped = items.filter(function (r) { return r.category === cat.name; });
    if (!grouped.length) continue;
    lines.push("<b>[" + cat.name + "]</b>");
    for (const row of grouped) {
      const who = peopleText(row);
      const head = who ? "<b>" + who + "</b> — " : "";
      lines.push("• [" + issueDate(row) + "] " + head + oneLine(row.summary) + senderTag(row));
    }
    lines.push("");
  }
  lines.push(SEPARATOR);
  lines.push("프로젝트 /project · 핵심 /brief");

  const out = lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
