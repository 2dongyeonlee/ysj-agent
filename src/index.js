// index.js — entry point. routing only. Bot stays silent unless explicitly called.
import { collectMessage } from "./collect.js";
import { runMorningBriefing, runBrief } from "./briefing.js";
import { summarizeFile, summarizeLatest } from "./summarize.js";
import { handleQA } from "./qa.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { handleVoice } from "./voice.js";
import { classifyIntent } from "./intent.js";
import { sendMessage, sendDocument, sendDocumentBytes } from "./telegram.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { addProjectKeyword, listProjects, deleteProject, addSubtask, listSubtasks, delSubtasks } from "./db.js";
import { runReclass } from "./reclass.js";

// 권한자 인식. (1) chat_id 기반: ADMIN_CHAT_ID 또는 BRIEFING_TARGET_ID 채팅 — @username
// 미설정 단말에서도 동작(권장). (2) ADMIN_USERNAMES @username 기반(보조).
const ALLOWED_ADMINS = ["CHANGE_ME"];
// 대시보드 변수 설정이 막힐 때를 위한 코드 내 관리자 chat_id (예: ["123456789"]).
// /whoami 로 확인한 본인 chat_id 를 넣으면 대시보드 없이 관리자 권한이 적용된다.
const ADMIN_CHAT_IDS = ["5965410906", "624410079"];

function csv(value) {
  return String(value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function adminUsernames(env) {
  const fromEnv = csv((env && env.ADMIN_USERNAMES) || "").map(function (s) { return s.replace(/^@/, "").toLowerCase(); });
  const fromCode = ALLOWED_ADMINS.map(function (s) { return String(s).trim().replace(/^@/, "").toLowerCase(); }).filter(Boolean);
  return fromEnv.concat(fromCode);
}

function adminChatIds(env) {
  return ADMIN_CHAT_IDS
    .concat(csv((env && env.ADMIN_CHAT_ID) || ""))
    .concat(csv((env && env.BRIEFING_TARGET_ID) || ""));
}

function isAdmin(env, msg) {
  const chatId = String((msg.chat && msg.chat.id) || "");
  if (chatId && adminChatIds(env).indexOf(chatId) !== -1) return true;
  const uname = String((msg.from && msg.from.username) || "").toLowerCase();
  return !!uname && adminUsernames(env).indexOf(uname) !== -1;
}

// '자료 적재' 메시지 판별: 전달(forward)·공유태그·보고문(장문/다항목)은 '질의'가 아니라
// 보관용 콘텐츠다. 조용히 수집만 하고 자동으로 브리핑/요약을 띄우지 않는다.
// (명시적 명령 /info 등이나 봇 멘션·자연어 질문일 때만 응답한다.)
function isDepositMessage(msg, text) {
  // 1) 전달된 메시지 — 남이 만든 콘텐츠를 그대로 옮겨 담는 것.
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat ||
      msg.forward_sender_name || msg.forward_date) return true;
  const t = String(text || "");
  // 2) 수동 공유 태그('공유:/공유자:/전달: 이름')로 시작.
  if (/^\s*(?:공유자?|전달자?)\s*[:：]/.test(t)) return true;
  // 3) 보고문 헤더(<Daily>, <주간> 등)로 시작.
  if (/^\s*<[^>\n]{1,20}>/.test(t)) return true;
  // 4) 다항목 브리핑([제목] 섹션 2개 이상).
  if ((t.match(/^[ \t]*\[[^\]\n]{1,40}\]/gm) || []).length >= 2) return true;
  // 5) 줄바꿈 있는 장문(질문이 아닌 보고문). 짧은 질의는 통과.
  if (t.length >= 200 && t.indexOf("\n") !== -1) return true;
  return false;
}

// 텔레그램 file_id → 다운로드 URL (R2 이관용). collect.js 의 동일 헬퍼.
async function getFileUrlPublic(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) return "";
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

const HELP =
  "📋 <b>사용 안내</b>\n\n" +
  "자료·녹음을 보내면 자동 저장·분류됩니다.\n" +
  "궁금한 건 그냥 말씀하시면 됩니다.\n\n" +
  "<b>명령어</b>\n" +
  "• /brief — 오늘 챙길 것 (결정·만남·보고 건)\n" +
  "• /info — 대외정보 7일치 (정부·국회·BH·글로벌·언론)\n" +
  "• /project [이름] — 프로젝트 진행 경과\n" +
  "• /summary [키워드] — 자료 요약\n\n" +
  "<b>자연어 질문 예시</b>\n" +
  "• \"넥서스 어떻게 됐어?\" — 프로젝트 현황\n" +
  "• \"오늘 만남 뭐 있어?\" — 브리핑\n" +
  "• \"김영훈 장관 면담 자료 공유해줘\" — 원본 전송\n\n" +
  "<i>프로젝트 관리: /addproject · /listproject · /delproject</i>\n" +
  "<i>기존 파일 재분류: /reclass</i>";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
    let update;
    try { update = await request.json(); } catch { return new Response("ok"); }
    if (update.my_chat_member) return new Response("ok");
    const msg = update.message;
    if (!msg) return new Response("ok");
    try { await route(env, msg); }
    catch (e) { console.error("route error", (e && e.stack) || e); }
    return new Response("ok");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async function () {
      await runMorningBriefing(env);
      await runInfoBriefing(env, null, 7);
    })());
  },
};

async function route(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || "").trim();
  const botUsername = env.BOT_USERNAME || "";

  const key = "msg:" + chatId + ":" + msg.message_id;
  if (await env.STATE.get(key)) return;
  await env.STATE.put(key, "1", { expirationTtl: 60 });

  // ---- commands (ASCII only). arg = text after the command ----
  if (text === "/help" || text === "/start") return sendMessage(env, chatId, HELP);

  // 내 chat_id·관리자 여부 확인 (권한 설정용). 누구나 사용 가능.
  if (text === "/whoami") {
    const uname = (msg.from && msg.from.username) ? "@" + msg.from.username : "(없음)";
    const ok = isAdmin(env, msg);
    return sendMessage(env, chatId,
      "🪪 <b>내 정보</b>\n" +
      "• chat_id: <code>" + chatId + "</code>\n" +
      "• username: " + uname + "\n" +
      "• 관리자 인식: " + (ok ? "예 ✅" : "아니오 ❌") +
      (ok ? "" :
        "\n\n관리자로 쓰려면 Cloudflare 대시보드 → Workers → ysj-agent → Settings → Variables 에\n" +
        "<code>ADMIN_CHAT_ID = " + chatId + "</code>\n추가 후 저장하세요(재배포 불필요)."));
  }

  // 기존 파일 일괄 이관 (권한자만): r2_key 빈 행을 R2 로 옮긴다.
  if (text === "/migrate") {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const { results } = await env.DB.prepare(
      "SELECT id, file_id, filename FROM files WHERE (r2_key = '' OR r2_key IS NULL) AND file_id != '' LIMIT 50"
    ).all();
    let done = 0, fail = 0;
    for (const row of (results || [])) {
      try {
        const url = await getFileUrlPublic(env, row.file_id);
        if (!url) { fail++; continue; }
        const fr = await fetch(url);
        if (!fr.ok) { fail++; continue; }
        const body = await fr.arrayBuffer();
        const key = "migrated/" + (row.filename || ("file_" + row.id)).replace(/[^\w.\-가-힣]/g, "_");
        await env.R2.put(key, body);
        await env.DB.prepare("UPDATE files SET r2_key = ? WHERE id = ?").bind(key, row.id).run();
        done++;
      } catch (e) {
        console.error("migrate row error", row.id, e && e.message);
        fail++;
      }
    }
    return sendMessage(env, chatId, "이관 완료: 성공 " + done + "건, 실패 " + fail + "건 (file_id 만료 시 실패)");
  }

  // 기존 적재 파일 재분류 (권한자만): 저장된 텍스트로 다시 분류해 R2 폴더 이동.
  if (text === "/reclass" || text.startsWith("/reclass ")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    return runReclass(env, chatId, text.indexOf("reset") !== -1);
  }

  // 프로젝트 키워드 관리 (권한자만)
  if (text.startsWith("/addproject")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/addproject", "").trim();
    let project = "", kwPart = "";
    if (arg.indexOf("|") !== -1) {
      const parts = arg.split("|");
      project = parts[0].trim();
      kwPart = parts.slice(1).join("|").trim();
    } else {
      const sp = arg.indexOf(" ");
      if (sp !== -1) { project = arg.slice(0, sp).trim(); kwPart = arg.slice(sp + 1).trim(); }
    }
    const keywords = kwPart.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!project || !keywords.length) {
      return sendMessage(env, chatId, "형식: /addproject 프로젝트 | 키워드,키워드\n예: /addproject 용인 Pull-in | 용인,pull-in\n\n※ 파일 공유 시 캡션에 #프로젝트명(예: #넥서스)을 적으면 그 폴더로 무조건 분류됩니다.");
    }
    for (const kw of keywords) await addProjectKeyword(env, project, kw);
    return sendMessage(env, chatId, "✅ <b>" + project + "</b> 키워드 추가: " + keywords.join(", "));
  }
  if (text.startsWith("/listproject")) {
    const map = await listProjects(env);
    const names = Object.keys(map);
    if (!names.length) return sendMessage(env, chatId, "등록된 프로젝트가 없습니다.");
    const body = names.map(function (p) { return "• <b>" + p + "</b>: " + map[p].join(", "); }).join("\n");
    return sendMessage(env, chatId, "📑 <b>프로젝트 키워드</b>\n\n" + body);
  }
  if (text.startsWith("/delproject")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const name = text.replace("/delproject", "").trim();
    if (!name) return sendMessage(env, chatId, "형식: /delproject 프로젝트");
    const n = await deleteProject(env, name);
    return sendMessage(env, chatId, n ? ("🗑 <b>" + name + "</b> 키워드 " + n + "개 삭제") : ("'" + name + "' 프로젝트를 찾지 못했습니다."));
  }

  // 프로젝트 하위과제 관리 (권한자만). /project 출력의 └ 항목.
  if (text.startsWith("/addsub")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/addsub", "").trim();
    const parts = arg.split("|");
    const proj = (parts[0] || "").trim();
    const subsRaw = parts.slice(1).join("|").trim();
    if (!proj || !subsRaw) return sendMessage(env, chatId, "형식: /addsub 프로젝트 | 하위과제1,하위과제2");
    const subs = subsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const s of subs) await addSubtask(env, proj, s);
    return sendMessage(env, chatId, "✅ <b>" + proj + "</b> 하위과제 추가: " + subs.join(", "));
  }
  if (text.startsWith("/listsub")) {
    const rows = await listSubtasks(env);
    if (!rows.length) return sendMessage(env, chatId, "등록된 하위과제가 없습니다.");
    const byProj = {};
    for (const r of rows) { (byProj[r.project] = byProj[r.project] || []).push(r.subtask); }
    const lines = ["📁 <b>프로젝트 하위과제</b>", ""];
    for (const p in byProj) lines.push("• <b>" + p + "</b>: " + byProj[p].join(", "));
    return sendMessage(env, chatId, lines.join("\n"));
  }
  if (text.startsWith("/delsub")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const proj = text.replace("/delsub", "").trim();
    if (!proj) return sendMessage(env, chatId, "형식: /delsub 프로젝트");
    await delSubtasks(env, proj);
    return sendMessage(env, chatId, "🗑 <b>" + proj + "</b> 하위과제 삭제");
  }

  // 프로젝트 항목 번호 조회: "1-1", "1-1 요약", "1-1 자료", "1 (1) 요약" (직전 /project 기준)
  const itemMatch = text.match(/^(\d+)\s*[-()\s]+\s*(\d+)\)?\s*(요약|자료|상세)?$/);
  if (itemMatch) {
    const tag = itemMatch[1] + "-" + itemMatch[2];
    const want = itemMatch[3] || "둘다";
    const raw = await env.STATE.get("projmap:" + chatId);
    if (!raw) return sendMessage(env, chatId, "먼저 /project 를 실행해 주세요. (번호는 직전 /project 기준)");
    let map;
    try { map = JSON.parse(raw); } catch { map = {}; }
    const item = map[tag];
    if (!item) return sendMessage(env, chatId, tag + " 항목을 찾을 수 없습니다. /project 를 다시 실행해 주세요.");
    return handleProjectItem(env, chatId, tag, item, want);
  }

  if (text.startsWith("/brief")) return runBrief(env, chatId);
  if (text.startsWith("/decision")) return runBrief(env, chatId); // decision 은 /brief 로 통합
  if (text.startsWith("/info")) {
    const arg = text.replace("/info", "").trim();
    const days = /^\d+$/.test(arg) ? parseInt(arg, 10) : 2; // 기본 전날+당일
    return runInfoBriefing(env, chatId, days);
  }
  if (text.startsWith("/project")) {
    const arg = text.replace("/project", "").trim();
    let days = 7, name = arg;
    const mNum = arg.match(/(\d+)/);
    if (mNum) { days = parseInt(mNum[1], 10); name = arg.replace(mNum[1], "").trim(); }
    return runProjectBriefing(env, chatId, days, name);
  }
  if (text.startsWith("/summary")) {
    const kw = text.replace("/summary", "").trim();
    return summarizeLatest(env, chatId, kw);
  }
  if (text.startsWith("/q ") || text === "/q") {
    const q = text.replace(/^\/q\s*/, "").trim();
    if (!q) return sendMessage(env, chatId, "질문을 입력해 주세요. 예: /q 어제 회의 결정사항은?");
    return handleQA(env, chatId, q);
  }

  // ---- silent collection (no auto-reply) ----
  await collectMessage(env, msg);

  if (msg.voice || msg.audio || (msg.document && (/audio/i.test(msg.document.mime_type || "") || /\.(ogg|oga|mp3|m4a|wav|aac|opus|flac|amr)$/i.test(msg.document.file_name || "")))) {
    const mentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
    // DM(1:1)이면 녹음 즉시 리치 요약 응답. 그룹은 멘션 시에만.
    await handleVoice(env, chatId, msg, mentioned || msg.chat.type === "private");
    return;
  }
  if (msg.document || (msg.photo && msg.photo.length)) {
    const mentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
    await summarizeFile(env, chatId, msg, mentioned);
    return;
  }

  // text: groups need mention; 1:1 uses natural-language intent classification.
  const isMentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
  const isDM = msg.chat.type === "private";

  // 전달·공유태그·보고문은 '자료 적재'다. 위 collectMessage 로 이미 저장됐으니
  // 자동 응답(브리핑/요약)은 띄우지 않는다. 단, 봇을 직접 멘션했으면 말을 건 것이므로 응답.
  if (isDepositMessage(msg, text) && !isMentioned) return;

  // Both 1:1 and group-mention go through the SAME natural-language routing,
  // so answers are identical in quality. Group: only when mentioned. 1:1: always.
  const cleanText = text.split("@" + botUsername).join("").trim();
  if ((isDM && text) || isMentioned) {
    const { intent, target } = await classifyIntent(env, cleanText);
    switch (intent) {
      case "summary":  return summarizeLatest(env, chatId, target);
      case "project":  return runProjectBriefing(env, chatId, 7, target);
      case "decision": return runBrief(env, chatId);
      case "info":     return runInfoBriefing(env, chatId, 2);
      case "brief":    return runBrief(env, chatId);
      case "question": return handleQA(env, chatId, cleanText);
      default:
        // mentioned => user explicitly addressed the bot, so answer anyway.
        if (isMentioned) return handleQA(env, chatId, cleanText);
        return; // 1:1 + none => silent (info delivery)
    }
  }
}

// 원본 파일 전송: file_id 재전송 우선 → 실패 시 R2 원본 바이트 업로드.
async function sendItemFile(env, chatId, item, fileInfo, caption) {
  if (item.ref) {
    try {
      const r = await sendDocument(env, chatId, item.ref, caption);
      if (r && r.ok) return true;
    } catch (e) { console.error("sendItemFile file_id", e && e.message); }
  }
  if (fileInfo && fileInfo.r2_key && env.R2) {
    try {
      const obj = await env.R2.get(fileInfo.r2_key);
      if (obj) {
        const buf = await obj.arrayBuffer();
        const r = await sendDocumentBytes(env, chatId, buf, fileInfo.filename || "자료", caption);
        if (r && r.ok) return true;
      }
    } catch (e) { console.error("sendItemFile R2", e && e.message); }
  }
  return false;
}

// /project 번호 항목(예: 1-1)의 원본 자료 전송 + 압축 요약 제공.
async function handleProjectItem(env, chatId, tag, item, want) {
  let fileInfo = null;
  if (item.ref) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT filename, r2_key, text FROM files WHERE file_id = ? ORDER BY id DESC LIMIT 1"
      ).bind(item.ref).all();
      if (results && results.length) fileInfo = results[0];
    } catch (e) { console.error("item file lookup", e && e.message); }
  }

  const header = "📌 <b>" + tag + "</b> · " + (item.project || "") + " (" + item.date + ")";

  // 자료: 원본 파일을 실제로 전송
  if (want === "자료" || want === "둘다") {
    const cap = header + (fileInfo && fileInfo.filename ? "\n📎 " + fileInfo.filename : "");
    const ok = await sendItemFile(env, chatId, item, fileInfo, cap);
    if (!ok) {
      await sendMessage(env, chatId, header + "\n📎 원본 파일을 전송할 수 없습니다" +
        (fileInfo && fileInfo.filename ? " (" + fileInfo.filename + ")" : " — 메시지 기반 항목이라 첨부 원본이 없습니다") + ".");
    }
  }

  // 요약: 원문을 압축 요약
  if (want === "요약" || want === "상세" || want === "둘다") {
    const base = String((fileInfo && fileInfo.text) ? fileInfo.text : (item.summary || "")).trim();
    if (!base) {
      await sendMessage(env, chatId, header + "\n(요약할 원문이 없습니다.)");
    } else {
      const sys = "다음 자료를 염성진 사장 보고용으로 '요약'하라. 원문을 그대로 옮기거나 표를 복사하지 말고 핵심만 압축하라.\n" +
        "- 맨 위 한 줄로 결론. 이어서 핵심 포인트 3~6개를 '• '로 짧게.\n" +
        "- 마크다운(표 |---|, #, **, -) 절대 금지. 강조는 <b></b>만. 불릿은 '• '.\n" +
        "- 숫자·날짜·금액·고유명사는 정확히 유지. 없는 내용은 지어내지 말 것.\n" +
        "- 결정·후속 사항이 있으면 마지막에 '결정/후속:' 한두 줄.";
      let detail;
      try {
        detail = await callClaude(env, "자료:\n" + base.slice(0, 12000), sys, MODEL_SMART, 900);
      } catch (e) {
        detail = "(요약 생성 실패) 원문 요지: " + String(item.summary || "").slice(0, 500);
      }
      await sendMessage(env, chatId, header + "\n" + detail);
    }
  }
}
