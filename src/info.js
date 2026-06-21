// info.js - external-affairs briefing from source_type='info' insights.

import { getInsightsSince } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const INFO_SYSTEM = PERSONA_STYLE + "\n\n" + `당신은 염성진 사장 대외정보 정리 비서다. 입력은 담당자가 공유한 DM 원문이다.

[분류] 각 항목을 아래 5개 중 하나로만 태그. 그 외 분류 생성 금지.
안 맞으면 가장 가까운 분류로 배정(기타 없음).
- 국회: 입법·의원·상임위·법안·정당
- 정부: 부처·공정위·산업부·규제기관
- BH: 대통령(V)·대통령실·총리·인선
- 글로벌: 해외기업·국제 산업동향·통상
- 언론: 보도·기사·PR·미디어 대응·재단/캠페인 (대면·정세 구분 없이 모두 여기)

[보존] 원문 항목을 합치지 말고 1:1 보존, 분류별로 묶는다. 각 항목 1~2줄.
사람을 만난 내용이면 만난 사람·소속을 문장에 포함(별도 칸 없음).

[꼬리표] 각 항목 끝에 (월/일 작성자). 예: (6/9 동연)
작성자·날짜는 파싱된 값만. 없으면 "—". 지어내지 말 것.

[볼드] 사람 이름과 분류명은 <b>굵게</b>.

[금지] 줄글 나열 금지. 위 양식만. 없는 메타 추론 금지.

[출력 양식]
📊 대외정보 · {보고일}
═══════════════
🏢 <b>정부</b>
• {핵심 1~2줄} (6/9 <b>동연</b>)
• {핵심} (6/9 <b>동연</b>)

🌐 <b>글로벌</b>
• {핵심} (6/9 <b>동연</b>)
═══════════════`;

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function displayPeriod(rows, days) {
  const dates = (rows || []).map(function (r) { return r.report_date || ""; }).filter(Boolean).sort();
  if (dates.length) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    return first === last ? first : first + "~" + last;
  }
  const end = new Date();
  const start = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000);
  return (start.getMonth() + 1) + "/" + start.getDate() + "~" + (end.getMonth() + 1) + "/" + end.getDate();
}

function buildDigest(rows) {
  return (rows || []).map(function (r) {
    const category = r.category || "—";
    const date = r.report_date || "—";
    const author = r.author || r.sender || "—";
    const people = r.people ? " / 인물: " + r.people : "";
    return "[" + category + "] (" + date + " " + author + ") " + (r.summary || "") + people;
  }).join("\n");
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

export async function runInfoBriefing(env, chatId, days) {
  const rows = await getInsightsSince(env, sinceDaysIso(days || 1), { sourceType: "info" });
  const cat = (rows || []).filter(function (r) { return r.category && r.summary; });
  if (!cat.length) {
    if (chatId) await sendMessage(env, chatId, "최근 정리된 대외정보가 없습니다.");
    return;
  }

  const period = displayPeriod(cat, days || 1);
  const digest = buildDigest(cat);
  const out = await callClaude(
    env,
    "보고일: " + period + "\n\n대외정보 항목:\n" + digest,
    INFO_SYSTEM,
    MODEL_SMART,
    2200
  );

  if (chatId) {
    await sendLongMessage(env, chatId, out);
  } else {
    const targets = String(env.BRIEFING_TARGET_ID || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const id of targets) await sendLongMessage(env, id, out);
  }
}
