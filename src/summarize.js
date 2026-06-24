// summarize.js - file -> text extraction -> structured summary and insight storage.

import { extractText } from "./docparse.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { loadProjectKeywords, matchProjects, detectDone, detectUrgent, classifyInfoCategory, normalizeProject, parseInfoMeta } from "./insight.js";
import { saveFile, updateInsightDone } from "./db.js";
import { createMeetingMinutes, withMetaFollowup } from "./voice.js";

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

const SUMMARY_SYSTEM = PERSONA_STYLE + "\n\n" + `당신은 염성진 사장 보고 비서다. 아래 양식만 채워라. 이모지·마크다운 금지, HTML <b>만. 줄글 나열 금지, 불릿로 끊어 쓴다. 자료에 없는 항목은 '없음'/'미상', 지어내지 말 것.

■ <b>배경</b>
맥락 1줄

■ <b>주요 내용</b>
- 핵심 (구체값·숫자 포함)
- 핵심

■ <b>Action Item</b>
- 담당/기한 액션, 없으면 '없음'

■ <b>일정</b>
- 명시된 날짜·마감, 없으면 '없음'

■ <b>참석/관계자</b>
- 인물·소속, 없으면 '미상'`;

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
  const filename = (msg.document && msg.document.file_name) || "document";
  const sender = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") : "";
  const short = stripHtml(minutes.short || "").slice(0, 500);
  const full = minutes.full || minutes.short || "";
  if (fileId) {
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: fileId,
      r2_key: "",
      filename,
      text: text.slice(0, 16000),
      sender,
      doc_type: "meeting",
      full_minutes: full || null,
    });
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

export async function enqueueDocumentSummary(env, chatId, msg, options = {}) {
  const key = "ds:" + String(chatId) + ":" + String(msg.message_id || Date.now());
  const asMeeting = !!(options.asMeeting || options.forceMeeting);
  await env.STATE.put(key, JSON.stringify({ chatId: String(chatId), msg, asMeeting, forceMeeting: asMeeting }), { expirationTtl: 1800 });
}

export async function runDocumentSummaryQueue(env) {
  const list = await env.STATE.list({ prefix: "ds:" });
  if (!list.keys || !list.keys.length) return;
  const key = list.keys[0].name;
  const raw = await env.STATE.get(key);
  if (!raw) {
    await env.STATE.delete(key);
    return;
  }
  let job = null;
  try {
    job = JSON.parse(raw);
  } catch (e) {
    console.error("document summary queue parse error", e && e.message);
    await env.STATE.delete(key);
    return;
  }
  try {
    await summarizeFile(env, job.chatId, job.msg, true, { asMeeting: !!(job.asMeeting || job.forceMeeting) });
  } catch (e) {
    console.error("document summary queue error", e && (e.stack || e.message));
    await sendMessage(env, job.chatId, "문서 처리 중 오류가 발생했습니다. PDF가 스캔본/암호화 파일이면 텍스트 선택 가능한 PDF, .docx, 또는 .txt로 다시 보내주세요.");
  } finally {
    await env.STATE.delete(key);
  }
}

export async function summarizeFile(env, chatId, msg, replyToUser = false, options = {}) {
  const text = await extractText(env, msg);
  if (!text) {
    if (replyToUser) {
      await sendMessage(env, chatId, "문서 본문을 읽지 못했습니다. PDF가 암호화/스캔본이거나 파일을 가져오지 못했을 수 있습니다. 텍스트 선택 가능한 PDF, .docx, 또는 .txt로 다시 보내주세요.");
    }
    return;
  }
  if (/^\[(document parse failed|docx parse failed|docx text not found|docx compression unsupported|file too large|legacy Word|only PDF)/i.test(String(text).trim())) {
    if (replyToUser) {
      await sendMessage(env, chatId, "문서 본문을 읽지 못했습니다. PDF는 텍스트가 선택되는 파일로, Word는 .docx 또는 .txt로 다시 보내주세요.");
    }
    return;
  }

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

  if (options.asMeeting || options.forceMeeting || isMeetingMemoFile(msg, text)) {
    let minutes = null;
    try {
      minutes = await createMeetingMinutes(env, text);
    } catch (e) {
      console.error("meeting document minutes error", e && e.message);
      minutes = {
        short: "■ <b>회의 메모</b>\n━━━━━━━━━━━━━━━━━━\n■ <b>결정 필요</b>\n- 없음\n\n■ <b>안건</b>\n1. 음성 메모 문서 — 회의록 생성에 실패해 원문 일부만 저장됨.\n   → 미결: 원문 재확인 필요.\n\n■ <b>후속조치</b>\n- 없음\n━━━━━━━━━━━━━━━━━━\n전체 회의록 필요 시 /minutes",
        full: text.slice(0, 4000),
      };
    }
    try {
      await saveMeetingDocument(env, msg, text, minutes);
    } catch (e) {
      console.error("meeting document save error", e && e.message);
    }
    await sendMessage(env, chatId, await withMetaFollowup(env, chatId, (msg.document && msg.document.file_id) || "", minutes.short));
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

  let out = await callClaude(env, "문서 내용:\n" + text.slice(0, 9000), SUMMARY_SYSTEM, MODEL_SMART, 2000);
  if (/참석\/관계자[\s\S]*?(미상|없음)/.test(out || "")) {
    out += "\n\n날짜·참석 명단·주요 아젠다를 알려주시면 반영해 다시 작성해 드립니다.";
  }
  await sendMessage(env, chatId, out || "요약 생성 실패. 다시 시도해주세요.");
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

// reply 대상 + 자유 지시 → 지시대로 처리. 관련 자료가 DB에 있으면 참고로 보강.
export async function smartReplyRequest(env, chatId, repliedMsg, instruction) {
  // 1) 주 자료 추출 (텍스트 → 문서 → 최근 저장자료 순)
  let source = "";
  if (repliedMsg.text || repliedMsg.caption) {
    source = String(repliedMsg.text || repliedMsg.caption).trim();
  } else if (repliedMsg.document) {
    try { source = await extractText(env, repliedMsg); } catch (e) { console.error("smartReply extract error", e && e.message); }
  }
  if (!source || source.length < 20) {
    try {
      const row = await env.DB.prepare(
        "SELECT text FROM files WHERE chat_id = ? AND text != '' ORDER BY id DESC LIMIT 1"
      ).bind(String(chatId)).first();
      if (row && row.text) source = row.text;
    } catch (e) { console.error("smartReply file error", e && e.message); }
  }
  if (!source || source.length < 20) {
    return sendMessage(env, chatId, "대상 내용을 읽지 못했습니다. 다른 자료에 reply 해주세요.");
  }
  // 2) 관련 자료 끌어오기 (주 자료 첫 키워드로 insights 검색, 실패해도 무시)
  let related = "";
  try {
    const kw = (source.replace(/[^\w가-힣 ]/g, " ").trim().split(/\s+/)[0] || "");
    if (kw && kw.length >= 2) {
      const { results } = await env.DB.prepare(
        "SELECT summary FROM insights WHERE chat_id = ? AND summary != '' AND summary LIKE ? ORDER BY id DESC LIMIT 3"
      ).bind(String(chatId), "%" + kw + "%").all();
      related = (results || []).map(function (r) { return r.summary; }).filter(Boolean).join("\n");
    }
  } catch (e) { /* 무시 */ }
  // 3) LLM: 지시 그대로 + 참고자료 보강
  const sys = PERSONA_STYLE + "\n\n" +
    "당신은 염성진 사장 보고 비서다. 사용자 요청을 그대로 이해해 [주 자료]를 처리하라. " +
    "[참고 자료]는 관련 맥락으로만 활용하고 없으면 무시한다. " +
    "이모지·마크다운 금지, HTML <b>만 사용. 표가 필요하면 줄/구분선으로 텔레그램에서 보기 좋게. " +
    "요청에 형식 지정이 없으면 다음 양식: ■ <b>배경</b> / ■ <b>주요 내용</b> / ■ <b>Action Item</b> / ■ <b>일정</b> / ■ <b>참석/관계자</b>. " +
    "자료에 없는 내용은 지어내지 말 것.";
  const prompt = "[사용자 요청]\n" + instruction +
    "\n\n[주 자료]\n" + source.slice(0, 10000) +
    (related ? ("\n\n[참고 자료]\n" + related.slice(0, 2000)) : "");
  try {
    const out = await callClaude(env, prompt, sys, MODEL_SMART, 2500);
    return sendMessage(env, chatId, out || "처리에 실패했습니다. 다시 시도해주세요.");
  } catch (e) {
    console.error("smartReplyRequest error", e && (e.stack || e.message));
    return sendMessage(env, chatId, "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}

// "OO 담당 오늘 공유자료 요약" → 발신자/날짜로 files 검색 후 요약. 못 찾으면 false.
export async function searchAndSummarize(env, chatId, text) {
  const sm = text.match(/([가-힣]{2,4})\s*(담당|TL|팀장|실장|부사장|사장|님|선임|책임)/);
  const sender = sm ? sm[1] : "";
  let dateCond = "";
  if (/오늘/.test(text))        dateCond = "date(created_at,'localtime') = date('now','localtime')";
  else if (/어제/.test(text))   dateCond = "date(created_at,'localtime') = date('now','-1 day','localtime')";
  else if (/이번\s*주|금주/.test(text)) dateCond = "date(created_at,'localtime') >= date('now','-7 day','localtime')";
  let sql = "SELECT filename, text FROM files WHERE chat_id = ? AND text != ''";
  const binds = [String(chatId)];
  if (sender)   { sql += " AND sender LIKE ?"; binds.push("%" + sender + "%"); }
  if (dateCond) { sql += " AND " + dateCond; }
  sql += " ORDER BY id DESC LIMIT 5";
  let rows;
  try { rows = (await env.DB.prepare(sql).bind(...binds).all()).results; }
  catch (e) { console.error("searchAndSummarize query error", e && e.message); return false; }
  if (!rows || !rows.length) return false;
  const merged = rows.map(function (r) { return "[" + (r.filename || "자료") + "]\n" + r.text; }).join("\n\n").slice(0, 10000);
  const sys = PERSONA_STYLE + "\n\n" +
    "당신은 염성진 사장 보고 비서다. 아래 자료를 다음 양식으로 요약하라. " +
    "■ <b>배경</b> / ■ <b>주요 내용</b> / ■ <b>Action Item</b> / ■ <b>일정</b> / ■ <b>참석/관계자</b>. " +
    "이모지·마크다운 금지, HTML <b>만. 없는 내용 창작 금지.";
  try {
    const out = await callClaude(env, "자료:\n" + merged, sys, MODEL_SMART, 2500);
    await sendMessage(env, chatId, out || "요약에 실패했습니다.");
  } catch (e) {
    console.error("searchAndSummarize llm error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "요약 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
  return true;
}
