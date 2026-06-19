// summarize.js — file -> (extract once) -> ONE combined Claude call for classify+summary.
// Token-optimized: 3 calls -> 2 calls. Extracted text stored in files.text for reuse.

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage, senderName } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";

const COMBINED_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 업로드된 문서를 염 사장 관점에서 분석. 분류와 요약을 한 번에 JSON으로만 반환.\n" +
  "마크다운/설명 없이 JSON만. 모르면 빈 문자열. 지어내지 말 것.\n" +
  "스키마:\n" +
  "{\n" +
  '  "schedule": "날짜+안건 (예: 6/20 회장 보고), 없으면 \\"\\"",\n' +
  '  "category": "정책|국회|BH|글로벌|언론PR 중 하나 또는 \\"\\"",\n' +
  '  "project": "Nexus|PJT A|서남권|G건|용인 Pull-in|성과금|TM PI|그룹 광고|PR 중요기사|기타 중 하나 또는 \\"\\"",\n' +
  '  "people": "관련 인물/소속, 없으면 \\"\\"",\n' +
  '  "summary_html": "텔레그램 전송용 요약. 음슴체, 1-2줄, 날짜·사람·안건 <b>굵게</b>. 형식: 📋 <b>제목</b>\\\\n\\\\n📌 핵심\\\\n• 1-2줄"\n' +
  "}";

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  // 1) extract text (1 Claude call inside docparse). store for reuse.
  const text = await extractText(env, msg);
  if (!text) return;
  const readText = text.slice(0, 9000);

  try {
    await env.DB.prepare(
      "UPDATE files SET text = ? WHERE id = (SELECT id FROM files WHERE chat_id = ? ORDER BY id DESC LIMIT 1)"
    ).bind(text.slice(0, 5000), String(msg.chat.id)).run();
  } catch (e) {
    console.error("files text update error", e && e.message);
  }

  // 2) ONE combined call: classify + summary together
  let parsed = null;
  try {
    const raw = await callClaude(env, "문서 내용:\n" + readText, COMBINED_SYSTEM, MODEL_SMART, 1500);
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("summarize combined parse error", e && e.message);
  }

  // 3) store insight (if anything useful)
  if (parsed && (parsed.schedule || parsed.category || parsed.project || parsed.summary_html)) {
    const plain = String(parsed.summary_html || "").replace(/<\/?[a-zA-Z]+>/g, "").trim();
    try {
      await env.DB.prepare(
        "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        String(msg.chat.id),
        "file",
        (msg.document && msg.document.file_id) || "",
        String(parsed.schedule || ""),
        String(parsed.category || ""),
        String(parsed.project || ""),
        plain.slice(0, 500),
        String(parsed.people || ""),
        senderName(msg),
        text.length,
        readText.length
      ).run();
      console.log("insight saved:", parsed.category || parsed.project || "general", plain.slice(0, 30));
    } catch (e) {
      console.error("insight insert error", e && e.message);
    }
  }

  if (!replyToUser) return;

  // 4) send summary (fallback to raw text head if parse failed)
  const out = (parsed && parsed.summary_html)
    ? parsed.summary_html
    : ("📋 <b>요약</b>\n\n📌 핵심\n• " + text.slice(0, 300));
  await sendMessage(env, chatId, out);
}

// /summary — summarize the most recently stored file for this chat (uses saved text, no re-extract).
export async function summarizeLatest(env, chatId) {
  let row = null;
  try {
    row = await env.DB.prepare(
      "SELECT filename, text FROM files WHERE chat_id = ? AND text != '' ORDER BY id DESC LIMIT 1"
    ).bind(String(chatId)).first();
  } catch (e) {
    console.error("summarizeLatest query error", e && e.message);
  }
  if (!row || !row.text) {
    return sendMessage(env, chatId, "최근 저장된 자료가 없습니다. 파일을 먼저 보내주세요.");
  }
  const out = await callClaude(env, "문서 내용:\n" + row.text.slice(0, 9000),
    PERSONA_STYLE + "\n\n[작업] 문서를 염 사장 관점에서 1-2줄 핵심만 요약. 날짜·사람·안건 <b>굵게</b>.\n형식: 📋 <b>제목</b>\n\n📌 핵심\n• 1-2줄",
    MODEL_SMART, 1200);
  await sendMessage(env, chatId, out);
}
