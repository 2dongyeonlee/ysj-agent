// index.js — entry point. routing only. Bot stays silent unless explicitly called (/q, mention, commands).
import { collectMessage } from "./collect.js";
import { runMorningBriefing, runContactBriefing } from "./briefing.js";
import { handleRetrieve } from "./retrieve.js";
import { handleMeetingPrep } from "./prep.js";
import { summarizeFile, summarizeLatest } from "./summarize.js";
import { handleQA } from "./qa.js";
import { handleSettings } from "./settings.js";
import { runWeeklyReport, runHighLevelDraft } from "./report.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { handleVoice } from "./voice.js";
import { sendMessage } from "./telegram.js";

const HELP = "📋 <b>명령어</b>\n" +
  "/q [질문] — 질문에 답변\n" +
  "/info — 대외정보 요약\n" +
  "/project — 프로젝트 현황\n" +
  "/brief — 아침 브리핑\n" +
  "/summary — 방금 올린 자료 요약\n" +
  "/contacts — 면담 이력\n" +
  "/weekly — 주간 업무보고\n" +
  "/report — 보고 초안\n\n" +
  "메시지·파일·녹음은 조용히 저장·분류됩니다. 답변은 /q 또는 멘션 시에만.";

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
      const kstDay = new Date(Date.now() + 9 * 3600000).getDay();
      if (kstDay === 1) await runProjectBriefing(env, null, 7);
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

  // ---- explicit commands (ASCII only) ----
  if (text === "/help" || text === "/start") return sendMessage(env, chatId, HELP);
  if (text.startsWith("/set")) {
    const reply = await handleSettings(env, text.replace("/set", "").trim());
    return sendMessage(env, chatId, reply);
  }
  if (text === "/contacts") return runContactBriefing(env, chatId);
  if (text.startsWith("/info")) {
    const days = Number(text.replace("/info", "").trim()) || 1;
    return runInfoBriefing(env, chatId, Math.max(1, Math.min(days, 30)));
  }
  if (text.startsWith("/project")) return runProjectBriefing(env, chatId, 7);
  if (text.startsWith("/brief")) return runMorningBriefing(env);
  if (text.startsWith("/weekly")) return runWeeklyReport(env, chatId, 7);
  if (text.startsWith("/report")) return runHighLevelDraft(env, chatId, 14);
  if (text.startsWith("/summary")) return summarizeLatest(env, chatId);

  // /q [question] — the ONLY way to ask in 1:1 (and works in groups too)
  if (text.startsWith("/q ") || text === "/q") {
    const q = text.replace(/^\/q\s*/, "").trim();
    if (!q) return sendMessage(env, chatId, "질문을 입력해 주세요. 예: /q 어제 회의 결정사항은?");
    return handleQA(env, chatId, q);
  }

  // ---- silent collection (no auto-reply) ----
  await collectMessage(env, msg);

  // voice/audio: store + classify silently. Reply only when mentioned.
  if (msg.voice || msg.audio || (msg.document && /audio|ogg|mp3|m4a|wav/i.test((msg.document.mime_type || "")))) {
    const mentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
    await handleVoice(env, chatId, msg, mentioned);
    return;
  }

  // file/image: store + classify silently. Reply only when mentioned.
  if (msg.document || (msg.photo && msg.photo.length)) {
    const mentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
    await summarizeFile(env, chatId, msg, mentioned);
    return;
  }

  // text: answer ONLY when mentioned (groups). 1:1 plain text = silent (info delivery).
  // To ask in 1:1, user must use /q.
  const isMentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
  if (isMentioned) {
    return handleQA(env, chatId, text.split("@" + botUsername).join("").trim());
  }
  // otherwise: silent (already collected above)
}
