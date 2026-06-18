// docparse.js — 파일에서 텍스트 추출. summarize/retrieve 공용 헬퍼.

const ANTHROPIC = "https://api.anthropic.com/v1/messages";

function tgFileUrl(env, filePath) {
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

async function getFileUrl(env, fileId) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error("getFile failed");
  return tgFileUrl(env, data.result.file_path);
}

// 이미지 → Claude Vision 설명
async function describeImage(env, url, caption = "") {
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
          { type: "text", text: `이 이미지 내용을 한국어 플레인 텍스트로 설명. 마크다운 금지.\n글자·수치 있으면 그대로 읽고, 문서·슬라이드면 제목·날짜·핵심수치·고유명사를 추출.${caption ? `\n설명: ${caption}` : ""}` },
        ],
      }],
    }),
  });
  const data = await res.json();
  return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") || "";
}

// PDF → Claude document 분석
async function extractPdf(env, url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 32 * 1024 * 1024) return "[파일이 너무 큽니다]";
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
          { type: "text", text: "이 문서의 제목·날짜·작성자·핵심내용·고유명사를 한국어 플레인 텍스트로 추출. 마크다운 금지." },
        ],
      }],
    }),
  });
  const data = await r.json();
  return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") || "[문서 분석 실패]";
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
      // PPTX/DOCX/XLSX 등은 다음 단계(B)에서 추가. 지금은 미지원 안내.
      return `[현재 PDF·이미지만 지원합니다: ${name}]`;
    }
  } catch (e) {
    console.error("extractText error", e?.message || e);
    return "";
  }
  return "";
}
