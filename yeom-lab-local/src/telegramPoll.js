// telegramPoll.js — 텔레그램 장폴링(long polling) 루프. 웹훅을 대체.
// PC가 공인 IP·포트포워딩·터널 없이도 인터넷에만 연결돼 있으면 동작한다.
// route()/handleCallback() 은 index.js 원본과 동일 — 업데이트를 받는 방식만 바뀐다.

import { route, handleCallback } from "./index.js";
import { sendMessage } from "./telegram.js";

const OFFSET_KEY = "tg:poll:offset";

async function getUpdates(env, offset) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates` +
    `?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(["message", "callback_query"]))}`;
  // Telegram 장폴링 자체가 최대 30초 대기하므로 여유를 두고 40초에서 끊는다.
  const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
  const data = await res.json();
  if (!data.ok) throw new Error("getUpdates failed: " + JSON.stringify(data));
  return data.result;
}

async function dispatchOne(env, update) {
  if (update.my_chat_member) return;
  if (update.callback_query) {
    return handleCallback(env, update.callback_query).catch((e) => {
      console.error("callback error", (e && e.stack) || e);
    });
  }
  const msg = update.message;
  if (!msg) return;
  return route(env, msg).catch((e) => {
    console.error("route error", (e && e.stack) || e);
    const cid = msg.chat && msg.chat.id;
    if (cid) {
      return sendMessage(env, cid, "⚠️ 처리 중 오류가 발생했습니다: " + String((e && e.message) || e).slice(0, 300)).catch(() => {});
    }
  });
}

// 재시작해도 밀린/중복 업데이트가 없도록 offset 을 KV(로컬 sqlite)에 저장해둔다.
export async function startPolling(env) {
  let offset = parseInt((await env.STATE.get(OFFSET_KEY)) || "0", 10) || 0;
  let running = true;
  console.log("[telegram] long polling 시작 (offset=" + offset + ")");

  (async function loop() {
    while (running) {
      let updates;
      try {
        updates = await getUpdates(env, offset);
      } catch (e) {
        console.error("[telegram] getUpdates error:", e && e.message);
        await new Promise((r) => setTimeout(r, 5000)); // 네트워크 오류 시 5초 후 재시도
        continue;
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        await env.STATE.put(OFFSET_KEY, String(offset));
        // 업데이트 하나가 오래 걸려도(회의록 생성 등) 다음 getUpdates 를 막지 않도록
        // 기다리지 않고 넘긴다 — 웹훅이 즉시 200 응답하던 것과 동일한 효과.
        dispatchOne(env, update);
      }
    }
  })();

  return {
    stop() { running = false; console.log("[telegram] long polling 중지"); },
  };
}
