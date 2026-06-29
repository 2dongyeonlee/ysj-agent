// info.js - external-affairs briefing from categorized insights.

import { getInfoInsightsSince } from "./db.js";
import { sendMessage } from "./telegram.js";
import { oneLine, issueDate, issueScore, stripHtml } from "./utils.js";
import { callClaude, MODEL_FAST } from "./claude.js";

function recentFirst(a, b) {
  const sa = issueScore(a), sb = issueScore(b);
  const ua = sa === 9999, ub = sb === 9999;
  if (ua !== ub) return ua ? 1 : -1;
  return sb - sa;
}

const INFO_CATEGORIES = [
  { name: "정부", icon: "" },
  { name: "국회", icon: "" },
  { name: "BH", icon: "" },
  { name: "언론", icon: "" },
  { name: "학계", icon: "" },
  { name: "글로벌", icon: "" },
  { name: "경쟁사", icon: "" },
];

const SEPARATOR = "─────";
const INFO_SYSTEM = `당신은 염성진 사장에게 대외정보를 보고하는 비서다.
입력은 여러 사람이 공유한 DM·파일·회의록 원문이다. 저장된 summary 앞부분을 베끼지 말고, 원문에서 사장에게 보고할 "안건"을 뽑아 한 줄 보고문으로 다시 작성하라.

[절대 원칙]
- 원문 하나에 여러 안건이 있으면 안건별로 분리한다.
- 각 안건은 1줄만 쓴다. 제목·목차·"1."·"Ⅱ."·문서 앞머리 복붙 금지.
- 사람이 만난 내용, 면담 참고자료, 회의록, 정책/언론 동향을 모두 "사장에게 공유된 대외정보" 관점으로 정리한다.
- 날짜는 원문에 명시된 사안일만 쓴다. 25/6처럼 일/월이면 6/25로 고친다. 30/0처럼 불가능한 날짜는 쓰지 말고 입력의 created 날짜 또는 "—"를 쓴다.
- 분류는 정부 / 국회 / BH / 언론 / 학계 / 글로벌 / 경쟁사 7개만 쓴다. 기타·내부 생성 금지.
- 출력은 아래 양식만. 설명, 사족, 마크다운 ** 금지. 굵게는 HTML <b>만 사용.
- 사람 이름·직책(장관·실장·의원·CEO 등)은 <b>굵게</b>. 예: <b>김성환 장관</b>, <b>나경원 의원</b>.
- 정부/국회/BH/언론/학계/글로벌/경쟁사 7개 분류는 모두 출력한다. 해당 분류 내용이 없으면 "• -" 한 줄만 쓴다.
- 각 카테고리 안에서 당사 직접 영향 건을 위로, 단순 참고 건은 뒤에 둔다.
- 부등호(<, >)를 본문에 쓰지 말 것. "이상/이하/초과/미만"으로 표기한다.
- 발신자 이름·약칭(SY, Yeom 등) 표기 금지. 중복 내용 병합. 구분선은 ─────만 사용. 불릿(•) 한 단계.

[분류 기준]
- 정부: 행정부(장관·차관·부처·정책실장)의 공식 입장·정책. 야당 정치인의 정부 비판은 '국회'로.
- BH: 대통령·대통령실·정무수석·국정상황실·비서실장·총리·인선
- 학계: 교수·박사 의견. 해외 사례 분석이어도 교수가 주체면 '학계'(글로벌 아님).
- 글로벌: 해외 정부/기업/정책, 미국·중국·일본·대만·EU, ASML·NVIDIA·Anthropic 등
- 국회: 여야 국회의원·정당의 발언·법안. 정치인 실명이 주체면 국회.
- 언론: 언론사(조선일보·중앙 등)의 보도·기사·논조. 언론사가 주체면 정부 비판 내용이어도 '언론'.
- 경쟁사: 삼성·B社·C社·TSMC·Micron·마이크론·CXMT·YMTC·키오시아·파운드리·테슬라·평택 P5·용인클러스터 인력·HBM 경쟁/추격 등 당사 경쟁 동향
- 자사(SK하이닉스) 광고·홍보 활동은 '내부'로 분류한다.

[출력 양식]
─────

■ <b>정부</b>
• [M/D] {안건 1줄}

■ <b>BH</b>
• [M/D] {안건 1줄}

■ <b>국회</b>
• [M/D] {안건 1줄}

■ <b>언론</b>
• [M/D] {안건 1줄}

■ <b>학계</b>
• [M/D] {안건 1줄}

■ <b>글로벌</b>
• [M/D] {안건 1줄}

■ <b>경쟁사</b>
• [M/D] {안건 1줄}

─────
대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief`;
const STOPWORDS = new Set([
  "보고요망", "관련", "통해", "대한", "대해", "하며", "하고", "있다", "있음", "중임",
  "필요", "강화", "추진", "가능성", "상황", "제기", "예정", "자료", "브리핑",
]);

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function kstSinceDb(days) {
  // KST 기준 (days)일 전 자정 -> DB 비교용 'YYYY-MM-DD HH:MM:SS'(UTC)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  kst.setUTCDate(kst.getUTCDate() - (days - 1));
  const utc = new Date(kst.getTime() - 9 * 60 * 60 * 1000);
  return utc.toISOString().slice(0, 19).replace("T", " ");
}

function todayText() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
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

function selectInfoItems(items) {
  const selected = [];
  for (const cat of INFO_CATEGORIES) {
    const grouped = items.filter(function (row) { return row.category === cat.name; }).slice(0, 4);
    selected.push(...grouped);
  }
  return selected.slice(0, INFO_CATEGORIES.length * 4);
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
  const blocks = items.map(function (row, idx) {
    const raw = sourceText(row).slice(0, 400);
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
    .replace(/📊\s*/g, "")
    .replace(/ℹ️\s*/g, "")
    .replace(/^[ \t]*(?:🏢|🇰🇷|🌐|🏛|🗞)\s*<b>([^<]+)<\/b>/gm, "■ <b>$1</b>")
    .replace(/^[ \t]*(?:☑|■|\[)?\s*<b>\[?(정부|국회|BH|언론|학계|글로벌|경쟁사)\]?<\/b>\]?/gm, "■ <b>$1</b>")
    .replace(/(?:대외정보\s*\/info\s*·\s*)?프로젝트\s*\/project\s*·\s*(?:핵심|업무\s*브리핑)\s*\/brief(?:\s*·\s*간략모드)?/g, "대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief")
    .trim();
}

async function composeInfoWithClaude(env, items) {
  const prompt = buildInfoPrompt(items);
  const out = await withTimeout(
    callClaude(env, prompt, INFO_SYSTEM, MODEL_FAST, 2200),
    25000,
    "info compose timeout"
  );
  const cleaned = cleanInfoOutput(out);
  // 성공 판정은 실제 출력 양식에 맞춘다. 헤더/구분선이 어긋나면 수동 폴백으로 빠진다.
  if (!cleaned.includes("─────") || !cleaned.includes("■")) return "";
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
  days = Math.max(1, parseInt(days || 2, 10) || 2);
  const kstMd = function (off) {
    const d = new Date(Date.now() + 9 * 3600 * 1000 - off * 86400000);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
  };
  const period = days <= 1 ? kstMd(0) : kstMd(days - 1) + "~" + kstMd(0);
  const greet = "<b>대외정보 요약 보고 (" + period + ")</b>\n\n";
  const rows = await getInfoInsightsSince(env, kstSinceDb(days || 2), INFO_CATEGORIES.map(function (c) { return c.name; }));
  const items = dedupeIssues((rows || []).filter(function (r) { return r.category && r.summary; }).sort(recentFirst));
  const visibleItems = selectInfoItems(items);
  if (!items.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  try {
    const composed = await composeInfoWithClaude(env, visibleItems);
    if (composed) {
      const body = greet + composed;
      if (chatId) {
        await sendLongMessage(env, chatId, body);
      } else {
        const targets = String(env.BRIEFING_TARGET_ID || env.BRIEFING_CHAT_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        for (const id of targets) await sendLongMessage(env, id, body);
      }
      return;
    }
  } catch (e) {
    console.error("composeInfoWithClaude error", e && e.message);
  }

  const lines = [SEPARATOR, ""];
  for (const cat of INFO_CATEGORIES) {
    const grouped = visibleItems.filter(function (r) { return r.category === cat.name; });
    lines.push("■ <b>" + cat.name + "</b>");
    if (grouped.length) {
      for (const row of grouped) {
        lines.push("• [" + issueDate(row) + "] " + oneLine(row.summary, 160));
      }
    } else {
      lines.push("• -");
    }
    lines.push("");
  }
  lines.push(SEPARATOR);
  lines.push("대외정보 /info · 프로젝트 /project · 업무 브리핑 /brief");

  const out = greet + lines.join("\n");
  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || env.BRIEFING_CHAT_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
