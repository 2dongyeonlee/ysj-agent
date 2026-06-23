// summarize.js - file -> text extraction -> structured summary and insight storage.

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { loadProjectKeywords, matchProjects, detectDone, detectUrgent, classifyInfoCategory, normalizeProject, parseInfoMeta } from "./insight.js";
import { updateInsightDone } from "./db.js";
import { createMeetingMinutes } from "./voice.js";

const COMBINED_SYSTEM = PERSONA_STYLE + "\n\n" + `문서를 읽고 JSON만 반환하라. 마크다운 금지.

[분류 규칙]
1. 자료 성격을 먼저 판정:
   - 프로젝트 추진 문서(nexus 등) → project=프로젝트명, category 비움
   - 대외정보(외부 정세·대면 활동) → category=5개 중 하나, project 비움
   - 내부 보고/운영계획(O/I 등) → category·project 모두 비움
2. category는 5개만: 정부 / 국회 / BH / 글로벌 / 언론
   - "정책"·"언론PR" 쓰지 말 것 → 정부·언론으로.
3. 대면 활동도 대외정보다. 만난 상대 소속으로 category 분류(정부 인사 면담→정부).
4. project는 nexus/넥서스 표기를 'nexus'로 통일.
5. 없는 값은 빈 문자열(''). 추론·창작 금지.

스키마:
{
  "kind": "project | info | internal",
  "schedule": "날짜+안건. 없으면 빈 문자열",
  "category": "정부, 국회, BH, 글로벌, 언론 중 하나. kind가 info가 아니면 빈 문자열",
  "project": "프로젝트명. nexus/넥서스는 nexus. kind가 project가 아니면 빈 문자열",
  "people": "관련 인물/소속. 없으면 빈 문자열",
  "summary_html": "사장이 30초 안에 파악하는 보고용 1줄 요약. 반드시 마침표로 끝나는 완결된 한 문장으로 쓰고 문장을 중간에 끊지 말 것. 본문의 구체값(금액·숫자·대상·일시·장소·참석자·기관명)을 포함해 '무엇을·누가·얼마·언제'가 드러나게. 80자 내외로 핵심만 담되 완결을 우선한다. 막연한 표현('지원 내용 발표','과제 보고') 금지. 인사말('사장님' 등)·머리표·번호('1.','Ⅱ.')·불릿·이모지·제목 형식 금지. 본문에 구체 내용이 없으면 '(내용 확인 필요)'."
}`;

const SUMMARY_SYSTEM = PERSONA_STYLE + "\n\n" + `당신은 염성진 사장 전담 비서다. 문서를 "요약"하지 말고 아래 칸을 채워라.
규칙:
- 칸에 해당하는 내용만 쓴다. 양식 밖 줄글 나열 금지.
- 각 칸은 1줄. 길면 자른다.
- 모르는 칸은 "—"로 둔다. 지어내지 않는다.
- "확정"과 "검토중/토의용"을 구분하라. 명시 없으면 "검토중".
- 날짜·인명·금액은 <b>굵게</b>.

[출력 양식]
📄 <b>{제목}</b>
🗓 {날짜} · 🏷 {프로젝트}
🎯 핵심: {이 문서가 말하는 단 하나, 1줄}
💰 규모: {핵심 숫자 2~3개, 없으면 —}
⚖️ 판단필요: {사장이 결정할 것, 없으면 "현 단계 없음"}
📌 상태: {확정 / 검토중 / 토의용 중 하나}`;

function isMeetingMemoFile(msg, text) {
  const filename = (msg.document && msg.document.file_name) || "";
  const caption = msg.caption || "";
  const hay = (filename + "\n" + caption + "\n" + String(text || "").slice(0, 2000)).toLowerCase();
  if (/회의록|녹취록|녹취|받아쓰기|전사본|음성\s*메모|미팅\s*메모|meeting minutes|transcript|minutes/.test(hay)) return true;
  const signals = ["회의", "논의", "발언", "안건", "결정", "미결", "후속", "참석", "화자"];
  let count = 0;
  for (const s of signals) if (hay.includes(s.toLowerCase())) count++;
  return count >= 3;
}

function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").trim();
}

async function saveMeetingDocument(env, msg, text, minutes) {
  const fileId = (msg.document && msg.document.file_id) || "";
  const sender = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") : "";
  const short = stripHtml(minutes.short || "").slice(0, 500);
  const full = minutes.full || minutes.short || "";
  if (fileId) {
    await env.DB.prepare(
      "UPDATE files SET text = ?, doc_type = 'meeting', full_minutes = ? WHERE file_id = ? AND chat_id = ?"
    ).bind(text.slice(0, 16000), full || null, fileId, String(msg.chat.id)).run();
  } else {
    await env.DB.prepare(
      "UPDATE files SET text = ?, doc_type = 'meeting', full_minutes = ? WHERE id = (SELECT id FROM files WHERE chat_id = ? ORDER BY id DESC LIMIT 1)"
    ).bind(text.slice(0, 16000), full || null, String(msg.chat.id)).run();
  }
  await env.DB.prepare(
    "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    String(msg.chat.id),
    "file",
    fileId,
    "",
    "",
    "",
    short,
    "",
    sender,
    text.length,
    Math.min(text.length, 16000)
  ).run();
}

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  const text = await extractText(env, msg);
  if (!text) return;

  try {
    const fileId = (msg.document && msg.document.file_id) || "";
    if (fileId) {
      await env.DB.prepare(
        "UPDATE files SET text = ? WHERE file_id = ? AND chat_id = ?"
      ).bind(text.slice(0, 5000), fileId, String(msg.chat.id)).run();
    } else {
      await env.DB.prepare(
        "UPDATE files SET text = ? WHERE id = (SELECT id FROM files WHERE chat_id = ? ORDER BY id DESC LIMIT 1)"
      ).bind(text.slice(0, 5000), String(msg.chat.id)).run();
    }
  } catch (e) {
    console.error("files text update error", e && e.message);
  }

  if (isMeetingMemoFile(msg, text)) {
    let minutes = null;
    try {
      minutes = await createMeetingMinutes(env, text);
    } catch (e) {
      console.error("meeting document minutes error", e && e.message);
      minutes = {
        short: "[회의 메모]\n━━━━━━━━━━━━━━━━━━\n[결정 필요]\n- 없음\n\n[안건]\n1. 음성 메모 문서 — 회의록 생성에 실패해 원문 일부만 저장됨.\n   → 미결: 원문 재확인 필요.\n\n[후속조치]\n- 없음\n━━━━━━━━━━━━━━━━━━\n전체 회의록 필요 시 /minutes",
        full: text.slice(0, 4000),
      };
    }
    try {
      await saveMeetingDocument(env, msg, text, minutes);
    } catch (e) {
      console.error("meeting document save error", e && e.message);
    }
    await sendMessage(env, chatId, minutes.short);
    return;
  }

  let parsed = null;
  try {
    const raw = await callClaude(env, "문서 내용:\n" + text.slice(0, 9000), COMBINED_SYSTEM, MODEL_SMART, 1500);
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("summarize combined parse error", e && e.message);
  }

  if (parsed && (parsed.schedule || parsed.category || parsed.project || parsed.summary_html)) {
    const plain = String(parsed.summary_html || "").replace(/<\/?[a-zA-Z]+>/g, "").trim();
    const caption = (msg.caption || "").trim();
    const filename = (msg.document && msg.document.file_name) || "";
    const matchText = caption + " " + filename + " " + text;
    const sender = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") : "";
    const meta = parseInfoMeta(caption + "\n" + text, sender, msg.date ? new Date(msg.date * 1000) : new Date());

    let projects = [];
    const keywords = await loadProjectKeywords(env);
    if (keywords) projects = matchProjects(keywords, caption, filename, text);
    const llmProject = normalizeProject(parsed.project);
    if (!projects.length && llmProject) projects = [llmProject];

    const project = projects[0] || "";
    const category = project ? "" : classifyInfoCategory(matchText, parsed.category);
    const urgent = detectUrgent(matchText);
    const summary = ((urgent ? "[보고요망] " : "") + plain).slice(0, 500);

    if (project && detectDone(matchText)) {
      try { await updateInsightDone(env, project); } catch (e) { console.error("updateInsightDone error", e && e.message); }
    }

    try {
      await env.DB.prepare(
        "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars, author, report_date) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        String(msg.chat.id),
        "file",
        (msg.document && msg.document.file_id) || "",
        String(parsed.schedule || ""),
        category,
        project,
        summary,
        String(parsed.people || ""),
        sender,
        text.length,
        Math.min(text.length, 9000),
        category ? meta.author : null,
        category ? meta.reportDate : null
      ).run();
    } catch (e) {
      console.error("insight insert error", e && e.message);
    }
    console.log("insight saved:", project || category || "general", plain.slice(0, 30));
  }

  if (!replyToUser) return;

  const out = (parsed && parsed.summary_html)
    ? parsed.summary_html
    : ("📄 <b>요약</b>\n\n🎯 핵심\n• " + text.slice(0, 300));
  await sendMessage(env, chatId, out);
}

export async function summarizeLatest(env, chatId, keyword) {
  let row = null;
  try {
    if (keyword) {
      const safe = keyword.replace(/[%_'"\\]/g, " ").trim().slice(0, 30);
      row = await env.DB.prepare(
        "SELECT filename, text FROM files WHERE chat_id = ? AND text != '' AND (filename LIKE ? OR text LIKE ?) ORDER BY id DESC LIMIT 1"
      ).bind(String(chatId), "%" + safe + "%", "%" + safe + "%").first();
    } else {
      row = await env.DB.prepare(
        "SELECT filename, text FROM files WHERE chat_id = ? AND text != '' ORDER BY id DESC LIMIT 1"
      ).bind(String(chatId)).first();
    }
  } catch (e) {
    console.error("summarizeLatest query error", e && e.message);
  }
  if (!row || !row.text) {
    if (keyword) return sendMessage(env, chatId, "'" + keyword + "' 관련 자료를 찾지 못했습니다. 해당 자료를 공유해 주시면 요약해 드리겠습니다.");
    return sendMessage(env, chatId, "최근 저장된 자료가 없습니다. 자료를 먼저 보내주세요.");
  }
  const out = await callClaude(env, "문서 내용:\n" + row.text.slice(0, 9000), SUMMARY_SYSTEM, MODEL_SMART, 1200);
  await sendMessage(env, chatId, out);
}
