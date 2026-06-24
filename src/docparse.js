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
  if (!r.ok || data.error) {
    console.error("extractPdf error", data.error && (data.error.message || data.error.type) || r.status);
    return "";
  }
  return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") || "[document parse failed]";
}

async function extractPlainText(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 4 * 1024 * 1024) return "[file too large]";
  return new TextDecoder("utf-8").decode(buf).trim();
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function xmlText(xml) {
  return String(xml || "")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:t[^>]*>/g, "")
    .replace(/<\/w:t>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 16 * 1024 * 1024) return "[file too large]";
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return "[docx parse failed]";
  const centralOffset = readU32(bytes, eocd + 16);
  const centralSize = readU32(bytes, eocd + 12);
  const decoder = new TextDecoder("utf-8");
  let pos = centralOffset;
  const end = centralOffset + centralSize;
  while (pos < end && readU32(bytes, pos) === 0x02014b50) {
    const method = readU16(bytes, pos + 10);
    const compSize = readU32(bytes, pos + 20);
    const nameLen = readU16(bytes, pos + 28);
    const extraLen = readU16(bytes, pos + 30);
    const commentLen = readU16(bytes, pos + 32);
    const localOffset = readU32(bytes, pos + 42);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    if (name === "word/document.xml") {
      const localNameLen = readU16(bytes, localOffset + 26);
      const localExtraLen = readU16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const packed = bytes.slice(dataStart, dataStart + compSize);
      const data = method === 0 ? packed : (method === 8 ? await inflateRaw(packed) : null);
      if (!data) return "[docx compression unsupported]";
      return xmlText(decoder.decode(data));
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return "[docx text not found]";
}

// PPTX(ZIP) 슬라이드 텍스트 추출 — extractDocx 의 ZIP 워크/inflateRaw 재사용.
// ppt/slides/slideN.xml 만 모아 N 순으로 정렬, 각 슬라이드의 <a:t> 텍스트를 뽑는다.
async function extractPptx(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 16 * 1024 * 1024) return "[file too large]";
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return "[pptx parse failed]";
  const centralOffset = readU32(bytes, eocd + 16);
  const centralSize = readU32(bytes, eocd + 12);
  const decoder = new TextDecoder("utf-8");
  let pos = centralOffset;
  const end = centralOffset + centralSize;
  const slides = []; // { n, xml }
  while (pos < end && readU32(bytes, pos) === 0x02014b50) {
    const method = readU16(bytes, pos + 10);
    const compSize = readU32(bytes, pos + 20);
    const nameLen = readU16(bytes, pos + 28);
    const extraLen = readU16(bytes, pos + 30);
    const commentLen = readU16(bytes, pos + 32);
    const localOffset = readU32(bytes, pos + 42);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) {
      const localNameLen = readU16(bytes, localOffset + 26);
      const localExtraLen = readU16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const packed = bytes.slice(dataStart, dataStart + compSize);
      const data = method === 0 ? packed : (method === 8 ? await inflateRaw(packed) : null);
      if (data) slides.push({ n: parseInt(m[1], 10), xml: decoder.decode(data) });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (!slides.length) return "[pptx text not found]";
  slides.sort(function (a, b) { return a.n - b.n; });
  const out = slides.map(function (s) {
    return (s.xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
      .map(function (t) {
        return t.replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
          .replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
      })
      .join("\n");
  }).join("\n\n").trim();
  return out || "[pptx text not found]";
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
      if (/\.(txt|md|csv)$/i.test(name)) {
        return await extractPlainText(url);
      }
      if (/\.docx$/i.test(name)) {
        return await extractDocx(url);
      }
      if (/\.pptx$/i.test(name)) {
        return await extractPptx(url);
      }
      if (/\.doc$/i.test(name)) {
        return "[legacy Word .doc files are not supported. Please send .docx, .pdf, or .txt: " + name + "]";
      }
      return "[only PDF, DOCX, PPTX, TXT, and image files are supported: " + name + "]";
    }
  } catch (e) {
    console.error("extractText error", e && e.message);
    return "";
  }
  return "";
}
