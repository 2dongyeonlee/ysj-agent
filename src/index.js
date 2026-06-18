// index.js — 엔트리포인트. 라우팅만 (얇게 유지). 로직은 각 모듈에 위임.

import { collectMessage } from "./collect.js";
import { runMorningBriefing, runContactBriefing } from "./briefing.js";
import { handleRetrieve } from "./retrieve.js";
import { handleMeetingPrep } from "./prep.js";
import { summarizeFile } from "./summarize.js";
import { handleQA } from "./qa.js";
import { handleSettings } from "./settings.js";
import { sendMessage } from "./telegram.js";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
    let update;
    try { update = await request.json(); } catch { return new Response("ok"); }

    // 봇이 방에 추가/제거됨 (운영 감지)
    if (update.my_chat_member) {
      // TODO: handleChatMemberUpdate (KOH봇 이식) — 방 등록/해제
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg) return new Response("ok");
    try { await route(env, msg); }
    catch (e) { console.error("route error", e?.stack || e); }
    return new Response("ok");
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runMorningBriefing(env)); // 기능1: 매일 아침 자동
  },
};

async function route(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || "").trim();

  // 중복 방지
  const key = `msg:${chatId}:${msg.message_id}`;
  if (await env.STATE.get(key)) return;
  await env.STATE.put(key, "1", { expirationTtl: 60 });

  // 운영자 명령: /설정 (김선영이 봇 동작 조정)
  if (text.startsWith("/설정")) {
    const reply = await handleSettings(env, text.replace("/설정", "").trim());
    return sendMessage(env, chatId, reply);
  }

  // [입구] 모든 메시지·자료 무음 수집
  await collectMessage(env, msg);

  // 파일/이미지: 저장은 collect 가, 요약은 여기서.
  // 1:1 DM이거나 캡션에 봇 멘션 있으면 요약 응답, 아니면 무음 저장.
  if (msg.document || (msg.photo && msg.photo.length)) {
    const botUsername = env.BOT_USERNAME || "";
    const isDM = msg.chat.type === "private";
    const replyToUser = isDM || (botUsername && text.includes(`@${botUsername}`));
    await summarizeFile(env, chatId, msg, replyToUser);
    return;
  }

  // [분기] 봇에게 거는 요청
  //  기능3: /접촉 명령
  if (text === "/접촉") return runContactBriefing(env, chatId);

  //  기능4: "오늘 OO 만날건데" 패턴 — [stub, 추후 연결]
  //  기능2: 자료 요청 패턴 — [stub, 추후 연결]

  //  일반 질의응답: 1:1 DM은 항상 답, 단체방은 봇 멘션 시만
  const botUsername = env.BOT_USERNAME || "";
  const isDM = msg.chat.type === "private";
  const isMentioned = text.includes(`@${botUsername}`);
  if (isDM || isMentioned) {
    return handleQA(env, chatId, text.replace(`@${botUsername}`, "").trim());
  }
}
