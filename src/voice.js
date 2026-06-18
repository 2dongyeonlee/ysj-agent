// voice.js — voice note -> STT (OpenAI gpt-4o-transcribe) -> Claude summary -> Telegram.
// STT provider isolated in transcribe() for later swap (e.g. CLOVA).

import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { extractInsight } from "./insight.js";

async function getFileUrl(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

async function transcribe(env, audioBuf, filename) {
  const form = new FormData();
  form.append("file", new Blob([audioBuf]), filename || "audio.ogg");
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ko");
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "authorization": "Bearer " + env.OPENAI_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("STT fail", res.status, t);
    throw new Error("STT failed " + res.status);
  }
  return (await res.text()).trim();
}

const VOICE_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래는 녹음(회의/메모) 받아쓰기 내용. 염 사장 관점에서 보고 가능한 형태로 요약.\n" +
  "출력 형식:\n\n" +
  "🎙 <b>녹음 요약</b>\n\n" +
  "📌 핵심\n• {주요 논의·결정. 결론 먼저}\n\n" +
  "💡 의사결정·후속\n• {판단/후속 필요사항}\n\n" +
  "🗒 전문\n{받아쓰기 원문 앞부분}";

export async function handleVoice(env, chatId, msg) {
  const voice = msg.voice || msg.audio || (msg.document && /audio|ogg|mp3|m4a|wav/i.test(msg.document.mime_type || "") ? msg.document : null);
  if (!voice) return;
  if (voice.file_size && voice.file_size > 25 * 1024 * 1024) {
    return sendMessage(env, chatId, "녹음 파일이 너무 큽니다 (25MB 초과). 잘라서 보내주세요.");
  }
  await sendMessage(env, chatId, "🎙 녹음을 받아쓰는 중입니다...");
  let transcript;
  try {
    const url = await getFileUrl(env, voice.file_id);
    const audioBuf = await (await fetch(url)).arrayBuffer();
    transcript = await transcribe(env, audioBuf, voice.file_name || "audio.ogg");
  } catch (e) {
    console.error("voice transcribe error", e && e.message);
    return sendMessage(env, chatId, "받아쓰기에 실패했습니다. 다시 시도해 주세요.");
  }
  if (!transcript) return sendMessage(env, chatId, "음성에서 텍스트를 추출하지 못했습니다.");
  await extractInsight(env, {
    chatId: msg.chat.id,
    sourceType: "voice",
    sourceRef: voice.file_id,
    text: transcript,
  });
  try {
    await env.DB.prepare(
      "INSERT INTO files (chat_id, file_id, filename, text) VALUES (?, ?, ?, ?)"
    ).bind(String(msg.chat.id), voice.file_id, voice.file_name || "voice", transcript.slice(0, 5000)).run();
  } catch (e) {
    console.error("voice save error", e && e.message);
  }
  const summary = await callClaude(env, "받아쓴 내용:\n" + transcript.slice(0, 8000), VOICE_SYSTEM, MODEL_SMART, 2000);
  await sendMessage(env, chatId, summary);
}
