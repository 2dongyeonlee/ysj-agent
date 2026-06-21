// index.js — entry point. routing only. Bot stays silent unless explicitly called.
import { collectMessage } from "./collect.js";
import { runMorningBriefing, runBrief } from "./briefing.js";
import { summarizeFile, summarizeLatest } from "./summarize.js";
import { handleQA } from "./qa.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { handleVoice } from "./voice.js";
import { classifyIntent } from "./intent.js";
import { sendMessage } from "./telegram.js";
import { addProjectKeyword, listProjects, deleteProject } from "./db.js";

// 권한자 텔레그램 username (앞의 @ 제외). 동연 username 으로 교체 필요.
// env.ADMIN_USERNAMES (쉼표구분) 가 있으면 함께 허용.
const ALLOWED_ADMINS = ["CHANGE_ME"];

function adminList(env) {
  const fromEnv = String((env && env.ADMIN_USERNAMES) || "")
    .split(",").map(function (s) { return s.trim().replace(/^@/, "").toLowerCase(); }).filter(Boolean);
  const fromCode = ALLOWED_ADMINS.map(function (s) { return String(s).trim().replace(/^@/, "").toLowerCase(); }).filter(Boolean);
  return fromEnv.concat(fromCode);
}

function isAdmin(env, msg) {
  const uname = String((msg.from && msg.from.username) || "").toLowerCase();
  if (!uname) return false;
  return adminList(env).indexOf(uname) !== -1;
}

const HELP =
  "📋 <b>사용 안내</b>\n\n" +
  "궁금한 건 그냥 말씀하시면 됩니다.\n" +
  "• \"넥서스 어떻게 됐어?\" — 프로젝트 현황\n" +
  "• \"대외동향 어때?\" — 대외 정보\n" +
  "• \"자료 요약해줘\" — 받은 자료 요약\n" +
  "• \"이번주 현안 브리핑\" — 보고요망·의사결정·종합\n\n" +
  "완료 처리는 \"넥서스 완료\"처럼 프로젝트명과 함께 말씀하시면 됩니다.\n" +
  "자료·녹음을 보내면 조용히 저장·분류됩니다.\n\n" +
  "<i>명령어: /info /project /summary /brief</i>\n" +
  "<i>관리: /addproject 프로젝트 | 키워드,키워드  ·  /listproject  ·  /delproject 프로젝트</i>";

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
      await runInfoBriefing(env, null, 1);
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

  // 프로젝트 키워드 관리 (권한자만)
  if (text.startsWith("/addproject")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다.");
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
      return sendMessage(env, chatId, "형식: /addproject 프로젝트 | 키워드,키워드\n예: /addproject 용인 Pull-in | 용인,pull-in");
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
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다.");
    const name = text.replace("/delproject", "").trim();
    if (!name) return sendMessage(env, chatId, "형식: /delproject 프로젝트");
    const n = await deleteProject(env, name);
    return sendMessage(env, chatId, n ? ("🗑 <b>" + name + "</b> 키워드 " + n + "개 삭제") : ("'" + name + "' 프로젝트를 찾지 못했습니다."));
  }

  if (text.startsWith("/brief")) return runBrief(env, chatId);
  if (text.startsWith("/decision")) return runBrief(env, chatId); // decision 은 /brief 로 통합
  if (text.startsWith("/info")) return runInfoBriefing(env, chatId, 1);
  if (text.startsWith("/project")) {
    const name = text.replace("/project", "").trim();
    return runProjectBriefing(env, chatId, 7, name);
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

  if (msg.voice || msg.audio || (msg.document && /audio|ogg|mp3|m4a|wav/i.test((msg.document.mime_type || "")))) {
    const mentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
    await handleVoice(env, chatId, msg, mentioned);
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

  // Both 1:1 and group-mention go through the SAME natural-language routing,
  // so answers are identical in quality. Group: only when mentioned. 1:1: always.
  const cleanText = text.split("@" + botUsername).join("").trim();
  if ((isDM && text) || isMentioned) {
    const { intent, target } = await classifyIntent(env, cleanText);
    switch (intent) {
      case "summary":  return summarizeLatest(env, chatId, target);
      case "project":  return runProjectBriefing(env, chatId, 7, target);
      case "decision": return runBrief(env, chatId);
      case "info":     return runInfoBriefing(env, chatId, 1);
      case "brief":    return runBrief(env, chatId);
      case "question": return handleQA(env, chatId, cleanText);
      default:
        // mentioned => user explicitly addressed the bot, so answer anyway.
        if (isMentioned) return handleQA(env, chatId, cleanText);
        return; // 1:1 + none => silent (info delivery)
    }
  }
}
