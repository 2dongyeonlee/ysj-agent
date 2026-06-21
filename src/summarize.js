// summarize.js — file -> (extract once) -> ONE combined Claude call for classify+summary.
// Token-optimized: 3 calls -> 2 calls. Extracted text stored in files.text for reuse.

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { loadProjectKeywords, matchProjects, detectFollowup, detectDone, detectUrgent, normalizeCategory, normalizeDecision, normalizeSource, parseInfoMeta } from "./insight.js";
import { updateInsightDone } from "./db.js";

// project 는 LLM 자유판단이 아니라 키워드 매칭으로 결정하므로 스키마에서 제외.
const COMBINED_SYSTEM = PERSONA_STYLE + "\n\n" +
  "당신은 염성진 사장 전담 비서다. 문서를 \"요약\"하지 말고 아래 칸을 채워라.\n" +
  "규칙:\n" +
  "- 칸에 해당하는 내용만 쓴다. 양식 밖 줄글 나열 금지.\n" +
  "- 각 칸은 1줄. 길면 자른다.\n" +
  "- 모르는 칸은 \"—\"로 둔다. 지어내지 않는다.\n" +
  "- \"확정\"과 \"검토중/토의용\"을 구분하라. 명시 없으면 \"검토중\".\n" +
  "- 날짜·인명·금액은 <b>굵게</b>.\n" +
  "- 마크다운/설명 없이 JSON만 반환.\n" +
  "스키마:\n" +
  "{\n" +
  '  "schedule": "날짜+안건 (예: 6/20 회장 보고), 없으면 \\"\\"",\n' +
  '  "category": "국회, 정부, BH, 글로벌, 언론 중 정확히 하나 또는 \\"\\"",\n' +
  '  "people": "관련 인물/소속, 없으면 \\"\\"",\n' +
  '  "decision": "문서에서 확정/결정/승인된 사항. 예정/검토중/논의/토의용은 제외. 명시 없으면 \\"\\"",\n' +
  '  "source": "결정 근거 출처가 문서에 명시돼 있으면 그대로 작성(예: 5/30 전략위 보고). 없으면 \\"\\"",\n' +
  '  "summary_html": "반드시 이 양식 그대로 채움: 📄 <b>{제목}</b>\\\\n🗓 {날짜} · 🏷 {프로젝트}\\\\n🎯 핵심: {이 문서가 말하는 단 하나, 1줄}\\\\n💰 규모: {핵심 숫자 2~3개, 없으면 —}\\\\n⚖️ 판단필요: {사장이 결정할 것, 없으면 현 단계 없음}\\\\n📌 상태: {확정 / 검토중 / 토의용 중 하나}"\n' +
  "}";

export async function summarizeFile(env, chatId, msg, replyToUser = false) {
  // 1) extract text (1 Claude call inside docparse). store for reuse.
  const text = await extractText(env, msg);
  if (!text) return;

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
    const raw = await callClaude(env, "문서 내용:\n" + text.slice(0, 9000), COMBINED_SYSTEM, MODEL_SMART, 1500);
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("summarize combined parse error", e && e.message);
  }

  // 3) store insight (if anything useful). project = 키워드 매칭(캡션+파일명+본문).
  if (parsed && (parsed.schedule || parsed.category || parsed.summary_html)) {
    const plain = String(parsed.summary_html || "").replace(/<\/?[a-zA-Z]+>/g, "").trim();
    const category = normalizeCategory(parsed.category);
    const decision = normalizeDecision(parsed.decision);
    const source = normalizeSource(parsed.source);
    const caption = (msg.caption || "").trim();
    const filename = (msg.document && msg.document.file_name) || "";
    const matchText = caption + " " + filename + " " + text;
    const sender = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") : "";
    const meta = parseInfoMeta(caption + "\n" + text, sender, msg.date ? new Date(msg.date * 1000) : new Date());

    let projects = [];
    const keywords = await loadProjectKeywords(env);
    if (keywords) projects = matchProjects(keywords, caption, filename, text);

    const followup = detectFollowup(matchText);
    const isDone = detectDone(matchText);
    const urgent = detectUrgent(matchText);
    const summary = ((urgent ? "[보고요망] " : "") + plain).slice(0, 500);

    const targets = projects.length ? projects : [""];
    for (const project of targets) {
      if (project && isDone) {
        try { await updateInsightDone(env, project); } catch (e) { console.error("updateInsightDone error", e && e.message); }
      }
      try {
        await env.DB.prepare(
          "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, followup, done, decision, source) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          String(msg.chat.id),
          "file",
          (msg.document && msg.document.file_id) || "",
          String(parsed.schedule || ""),
          category,
          project,
          summary,
          String(parsed.people || ""),
          project ? followup : "",
          (project && isDone) ? 1 : 0,
          decision || null,
          source || null
        ).run();
      } catch (e) {
        console.error("insight insert error", e && e.message);
      }
    }
    if (category) {
      try {
        await env.DB.prepare(
          "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars, decision, source, author, report_date) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          String(msg.chat.id),
          "info",
          (msg.document && msg.document.file_id) || "",
          String(parsed.schedule || ""),
          category,
          "",
          summary,
          String(parsed.people || ""),
          sender,
          text.length,
          Math.min(text.length, 9000),
          decision || null,
          source || null,
          meta.author,
          meta.reportDate
        ).run();
      } catch (e) {
        console.error("info insight insert error", e && e.message);
      }
    }
    console.log("insight saved:", (projects.join(",") || category || "general"), plain.slice(0, 30));
  }

  if (!replyToUser) return;

  // 4) send summary (fallback to raw text head if parse failed)
  const out = (parsed && parsed.summary_html)
    ? parsed.summary_html
    : ("📋 <b>요약</b>\n\n📌 핵심\n• " + text.slice(0, 300));
  await sendMessage(env, chatId, out);
}

// /summary — summarize the most recently stored file for this chat (uses saved text, no re-extract).
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
  const out = await callClaude(env, "문서 내용:\n" + row.text.slice(0, 9000),
    PERSONA_STYLE + "\n\n" +
    "당신은 염성진 사장 전담 비서다. 문서를 \"요약\"하지 말고 아래 칸을 채워라.\n" +
    "규칙:\n" +
    "- 칸에 해당하는 내용만 쓴다. 양식 밖 줄글 나열 금지.\n" +
    "- 각 칸은 1줄. 길면 자른다.\n" +
    "- 모르는 칸은 \"—\"로 둔다. 지어내지 않는다.\n" +
    "- \"확정\"과 \"검토중/토의용\"을 구분하라. 명시 없으면 \"검토중\".\n" +
    "- 날짜·인명·금액은 <b>굵게</b>.\n\n" +
    "[출력 양식]\n" +
    "📄 <b>{제목}</b>\n" +
    "🗓 {날짜} · 🏷 {프로젝트}\n" +
    "🎯 핵심: {이 문서가 말하는 단 하나, 1줄}\n" +
    "💰 규모: {핵심 숫자 2~3개, 없으면 —}\n" +
    "⚖️ 판단필요: {사장이 결정할 것, 없으면 \"현 단계 없음\"}\n" +
    "📌 상태: {확정 / 검토중 / 토의용 중 하나}",
    MODEL_SMART, 1200);
  await sendMessage(env, chatId, out);
}
