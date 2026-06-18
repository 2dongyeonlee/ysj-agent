// docparse.js — extract text from files. shared helper for summarize/retrieve.

const ANTHROPIC = "https://api.anthropic.com/v1/messages";

async function getFileUrl(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

async function describeImage(env, url, caption) {
  const imgRes = await fetch(url);
  const buf = await imgRes.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  const ct = imgRes.headers.get("content-type") || "image/jpeg";

  const res = await fetch(ANTHROPIC, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: ct, data: b64 } },
          { type: "text", text: "Describe this image in Korean plain text. No markdown. If it contains text or numbers, read them. If it is a document or slide, extract title, date, key figures, and proper nouns." + (caption ? ("\nCaption: " + caption) : "") },
        ],
      }],
    }),
  });
  const data = await res.json();
  return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") || "";
}

async function extractPdf(env, url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 32 * 1024 * 1024) return "[file too large]";
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);

  const r = await fetch(ANTHROPIC, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: "Extract the title, date, author, key content and proper nouns from this document in Korean plain text. No markdown." },
        ],
      }],
    }),
  });
  const data = await r.json();
  return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") || "[document parse failed]";
}

export async function extractText(env, msg) {
  try {
    if (msg.photo && msg.photo.length) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const url = await getFileUrl(env, fileId);
      return await describeImage(env, url, msg.caption || "");
    }
    if (msg.document) {
      const name = msg.document.file_name || "";
      const url = await getFileUrl(env, msg.document.file_id);
      if (/\.(jpe?g|png|webp|gif)$/i.test(name)) {
        return await describeImage(env, url, msg.caption || "");
      }
      if (/\.pdf$/i.test(name)) {
        return await extractPdf(env, url);
      }
      return "[only PDF and image files are supported: " + name + "]";
    }
  } catch (e) {
    console.error("extractText error", e && e.message);
    return "";
  }
  return "";
}
