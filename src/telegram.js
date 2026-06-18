// telegram.js — 텔레그램 Bot API 래퍼. 봇 고유 로직 없는 순수 함수.

function apiBase(env) {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
}

export async function sendMessage(env, chatId, text) {
  const res = await fetch(`${apiBase(env)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("sendMessage fail", await res.text());
  return res.json();
}

export async function sendDocument(env, chatId, fileId, caption = "") {
  const res = await fetch(`${apiBase(env)}/sendDocument`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: fileId, caption }),
  });
  return res.json();
}

// 발신자 표시 이름 정리
export function senderName(msg) {
  const f = msg.from || {};
  return [f.first_name, f.last_name].filter(Boolean).join(" ") || f.username || "익명";
}
