// index.js — entry point. routing only (keep thin). logic lives in each module.
import { collectMessage } from "./collect.js";
import { runMorningBriefing, runContactBriefing } from "./briefing.js";
import { handleRetrieve } from "./retrieve.js";
import { handleMeetingPrep } from "./prep.js";
import { summarizeFile } from "./summarize.js";
import { handleQA } from "./qa.js";
import { handleSettings } from "./settings.js";
import { runWeeklyReport, runHighLevelDraft } from "./report.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { handleVoice } from "./voice.js";
import { sendMessage } from "./telegram.js";

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
    // morning: daily info briefing + contact briefing; weekly project on Monday
    ctx.waitUntil((async function () {
      await runMorningBriefing(env);
      await runInfoBriefing(env, null, 1);            // daily external-affairs
      const kstDay = new Date(Date.now() + 9 * 3600000).getDay();
      if (kstDay === 1) await runProjectBriefing(env, null, 7); // Monday weekly
    })());
  },
};

async function route(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || "").trim();

  const key = "msg:" + chatId + ":" + msg.message_id;
  if (await env.STATE.get(key)) return;
  await env.STATE.put(key, "1", { expirationTtl: 60 });

  // commands (ASCII to avoid encoding issues)
  if (text.startsWith("/set")) {
    const reply = await handleSettings(env, text.replace("/set", "").trim());
    return sendMessage(env, chatId, reply);
  }
  if (text === "/contacts") return runContactBriefing(env, chatId);
  if (text.startsWith("/info")) return runInfoBriefing(env, chatId, 1);
  if (text.startsWith("/project")) return runProjectBriefing(env, chatId, 7);
  if (text.startsWith("/weekly")) return runWeeklyReport(env, chatId, 7);
  if (text.startsWith("/report")) return runHighLevelDraft(env, chatId, 14);

  // collect every message/file silently
  await collectMessage(env, msg);

  // voice/audio: transcribe -> summarize (always reply in DM, or when mentioned)
  if (msg.voice || msg.audio || (msg.document && /audio|ogg|mp3|m4a|wav/i.test((msg.document.mime_type || "")))) {
    return handleVoice(env, chatId, msg);
  }

  // file/image: summarize replies when targeted
  if (msg.document || (msg.photo && msg.photo.length)) {
    const botUsername = env.BOT_USERNAME || "";
    const isDM = msg.chat.type === "private";
    const replyToUser = isDM || (botUsername && text.indexOf("@" + botUsername) !== -1);
    await summarizeFile(env, chatId, msg, replyToUser);
    return;
  }

  // general QA: DM always; group only when mentioned
  const botUsername = env.BOT_USERNAME || "";
  const isDM = msg.chat.type === "private";
  const isMentioned = botUsername && text.indexOf("@" + botUsername) !== -1;
  if (isDM || isMentioned) {
    return handleQA(env, chatId, text.split("@" + botUsername).join("").trim());
  }
}
