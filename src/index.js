// index.js — entry point. routing only. Bot stays silent unless explicitly called.
import { collectMessage } from "./collect.js";
import { runMorningBriefing } from "./briefing.js";
import { summarizeFile, summarizeLatest } from "./summarize.js";
import { handleQA } from "./qa.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { runDecisionBriefing } from "./decision.js";
import { handleVoice } from "./voice.js";
import { classifyIntent } from "./intent.js";
import { sendMessage } from "./telegram.js";

const HELP =
  "📋 <b>사용 안내</b>\n\n" +
  "궁금한 건 그냥 말씀하시면 됩니다.\n" +
  "• \"넥서스 어떻게 됐어?\" — 프로젝트 현황\n" +
  "• \"오늘 의사결정 사항?\" — 결정 필요사항\n" +
  "• \"대외동향 어때?\" — 대외 정보\n" +
  "• \"자료 요약해줘\" — 받은 자료 요약\n" +
  "• \"이번주 현안 브리핑\" — 현안 정리\n\n" +
  "자료·녹음을 보내면 조용히 저장·분류됩니다.\n\n" +
  "<i>명령어로도 가능: /info /project /decision /summary /brief</i>";

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

  if (text.startsWith("/brief")) {
    return runMorningBriefing(env, chatId);
  }
  if (text.startsWith("/info")) return runInfoBriefing(env, chatId, 1);
  if (text.startsWith("/decision")) return runDecisionBriefing(env, chatId, 14);
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
    // In groups a mention is an explicit call, so never stay silent there:
    // if intent is unclear, fall back to a real Q&A answer instead of "none".
    const { intent, target } = await classifyIntent(env, cleanText);
    switch (intent) {
      case "summary":  return summarizeLatest(env, chatId, target);
      case "project":  return runProjectBriefing(env, chatId, 7, target);
      case "decision": return runDecisionBriefing(env, chatId, 14);
      case "info":     return runInfoBriefing(env, chatId, 1);
      case "brief":    return runMorningBriefing(env, chatId);
      case "question": return handleQA(env, chatId, cleanText);
      default:
        // mentioned => user explicitly addressed the bot, so answer anyway.
        if (isMentioned) return handleQA(env, chatId, cleanText);
        return; // 1:1 + none => silent (info delivery)
    }
  }
}
