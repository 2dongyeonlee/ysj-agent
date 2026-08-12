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
  t = t.replace(/^[\s]*[━=]{3,}[\s]*$/gm, "");
  t = t.replace(/\*\*/g, "");              // remove ** bold markers
  t = t.replace(/^#{1,6}\s*/gm, "");       // remove # headers
  t = t.replace(/\n{3,}/g, "\n\n");        // collapse blank lines
  return t.trim();
}

// 텔레그램 한 메시지 한계는 4096자. 여유를 두고 이 크기로 쪼갠다.
const TG_CHUNK = 3900;

// 긴 텍스트를 줄 경계 기준으로 한도 이하 조각들로 나눈다. 아주 긴 한 줄은 강제로 자른다.
function splitChunks(text, limit) {
  const out = [];
  let buf = "";
  for (const line of String(text).split("\n")) {
    if (line.length > limit) {
      if (buf) { out.push(buf); buf = ""; }
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      continue;
    }
    const next = buf ? buf + "\n" + line : line;
    if (next.length > limit) { out.push(buf); buf = line; }
    else { buf = next; }
  }
  if (buf) out.push(buf);
  return out.length ? out : [""];
}

// 한 조각 전송(HTML 우선, 파싱 실패 시 평문 폴백). extra 는 reply_markup 등 추가 필드.
async function sendOne(env, chatId, text, extra) {
  const res = await fetch(`${apiBase(env)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), parse_mode: "HTML", ...(extra || {}) }),
  });
  if (!res.ok) {
    // HTML parse 실패(조각 경계가 태그를 끊은 경우 등) → 평문으로 재전송.
    console.error("sendMessage fail", await res.text());
    const plain = text.replace(/<\/?[a-zA-Z]+>/g, "");
    const retry = await fetch(`${apiBase(env)}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: plain.slice(0, 4096), ...(extra || {}) }),
    });
    return retry.json().catch(() => ({}));
  }
  return res.json().catch(() => ({}));
}

export async function sendMessage(env, chatId, text, extra) {
  const clean = cleanForHtml(text);
  if (clean.length <= TG_CHUNK) return sendOne(env, chatId, clean, extra);
  // 길면 잘라내지 말고 여러 메시지로 나눠 보낸다(회의록 등 전체 보존).
  // extra(인라인 버튼 등)는 마지막 조각에만 붙인다.
  const chunks = splitChunks(clean, TG_CHUNK);
  let last = {};
  for (let i = 0; i < chunks.length; i++) {
    last = await sendOne(env, chatId, chunks[i], i === chunks.length - 1 ? extra : undefined);
  }
  return last;
}

// callback_query 응답 — 버튼 클릭 시 로딩 스피너 해제. 반드시 호출할 것.
export async function answerCallbackQuery(env, callbackQueryId, text = "") {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = String(text).slice(0, 200);
  const res = await fetch(`${apiBase(env)}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

export async function sendDocument(env, chatId, fileId, caption = "") {
  const cleanFileId = String(fileId || "").trim().replace(/\s/g, "");
  if (!cleanFileId) { console.error("sendDocument: invalid file_id"); return { ok: false }; }
  const clean = cleanForHtml(caption);
  const res = await fetch(`${apiBase(env)}/sendDocument`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: cleanFileId, caption: clean.slice(0, 1000), parse_mode: "HTML" }),
  });
  if (!res.ok) {
    console.error("sendDocument fail", await res.text());
    const plain = clean.replace(/<\/?[a-zA-Z]+>/g, "");
    const retry = await fetch(`${apiBase(env)}/sendDocument`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, document: cleanFileId, caption: plain.slice(0, 1000) }),
    });
    if (!retry.ok) return { ok: false };
    return retry.json().catch(() => ({ ok: false }));
  }
  return res.json().catch(() => ({ ok: false }));
}

// 바이트(R2 원본 등)를 문서로 업로드 전송. file_id 재전송이 안 될 때 폴백.
export async function sendDocumentBytes(env, chatId, bytes, filename, caption = "") {
  const clean = cleanForHtml(caption);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (clean) {
    form.append("caption", clean.slice(0, 1000));
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([bytes]), filename || "file");
  const res = await fetch(`${apiBase(env)}/sendDocument`, { method: "POST", body: form });
  return res.json().catch(() => ({}));
}

// 전달자/발신자의 텔레그램 user id. 전달(forward) 메시지면 원 발신자 id 우선.
export function senderId(msg) {
  const m = msg || {};
  const fo = m.forward_origin || {};
  const fwdUser = m.forward_from || fo.sender_user;
  if (fwdUser && fwdUser.id) return String(fwdUser.id);
  if (m.from && m.from.id) return String(m.from.id);
  return "";
}

export function senderName(msg) {
  const m = msg || {};
  // 전달된(forward) 메시지면 '원 발신자(전달해준 사람)'를 우선 표기.
  const fo = m.forward_origin || {};
  const fwdUser = m.forward_from || fo.sender_user;
  if (fwdUser) {
    const n = [fwdUser.first_name, fwdUser.last_name].filter(Boolean).join(" ");
    if (n) return n;
    if (fwdUser.username) return fwdUser.username;
  }
  const fwdName = m.forward_sender_name || fo.sender_user_name || (fo.chat && fo.chat.title) || fo.author_signature;
  if (fwdName) return String(fwdName).trim();
  const f = m.from || {};
  return [f.first_name, f.last_name].filter(Boolean).join(" ") || f.username || "익명";
}
