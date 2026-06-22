// telegram.js — Telegram Bot API wrapper. pure functions.

function apiBase(env) {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
}

// Telegram HTML mode only allows a few tags. Clean text so parsing never fails:
// - drop markdown leftovers (---, **, ##)
// - keep <b>, <u>, <i>, <s>, <code>, <pre>; escape stray '<' '>' '&' elsewhere is
//   hard to do safely, so we only strip the markdown that breaks layout.
function cleanForHtml(text) {
  let t = String(text || "");
  t = t.replace(/^\s*-{3,}\s*$/gm, "");   // remove --- divider lines
  t = t.replace(/\*\*/g, "");              // remove ** bold markers
  t = t.replace(/^#{1,6}\s*/gm, "");       // remove # headers
  t = t.replace(/\n{3,}/g, "\n\n");        // collapse blank lines
  return t.trim();
}

export async function sendMessage(env, chatId, text) {
  const clean = cleanForHtml(text);
  const res = await fetch(`${apiBase(env)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: clean.slice(0, 3900),
      parse_mode: "HTML",
    }),
  });
  if (!res.ok) {
    // HTML parse failed -> retry as plain text (strip tags too)
    console.error("sendMessage fail", await res.text());
    const plain = clean.replace(/<\/?[a-zA-Z]+>/g, "");
    await fetch(`${apiBase(env)}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: plain.slice(0, 3900) }),
    });
  }
  return res.json().catch(() => ({}));
}

export async function sendDocument(env, chatId, fileId, caption = "") {
  const res = await fetch(`${apiBase(env)}/sendDocument`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: fileId, caption }),
  });
  return res.json().catch(() => ({}));
}

// 바이트(R2 원본 등)를 문서로 업로드 전송. file_id 재전송이 안 될 때 폴백.
export async function sendDocumentBytes(env, chatId, bytes, filename, caption = "") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([bytes]), filename || "file");
  const res = await fetch(`${apiBase(env)}/sendDocument`, { method: "POST", body: form });
  return res.json().catch(() => ({}));
}

export function senderName(msg) {
  const f = (msg && msg.from) || {};
  return [f.first_name, f.last_name].filter(Boolean).join(" ") || f.username || "익명";
}
