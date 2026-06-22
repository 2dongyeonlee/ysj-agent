// voice.js — voice note -> STT (OpenAI whisper-1 verbose, fallback gpt-4o-transcribe)
//            -> 분류·R2 백업·저장 -> 회의록 작성 -> Telegram.
// STT provider isolated in transcribe() for later swap (e.g. CLOVA).

import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage, senderName, senderId } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { extractInsight, captionProject, loadProjectKeywords } from "./insight.js";
import { saveFile } from "./db.js";
import { buildR2Key } from "./collect.js";

async function getFileUrl(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

const STT_PROMPT = "SK하이닉스 커뮤니케이션 총괄의 회의/간담회 녹음입니다. 여러 명이 번갈아 발언합니다. 인명·직책·기관명(SK하이닉스, 환경재단, UNEP 등)·프로젝트명(넥서스, 서남권, ADR 등)·숫자·금액을 정확히 받아쓰세요.";

function looksBadTranscript(text) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (body.length < 20) return true;
  const promptEcho = "SK하이닉스 커뮤니케이션 총괄의 회의";
  const echoCount = body.split(promptEcho).length - 1;
  if (echoCount >= 2) return true;
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length >= 20) {
    const unique = new Set(words);
    if (unique.size / words.length < 0.18) return true;
  }
  return false;
}

// OpenAI 최대 활용: whisper-1 + verbose_json 으로 세그먼트(시간) 확보.
// 화자 분리는 OpenAI 미지원이나, 시간 세그먼트가 발화 전환 추정 단서가 된다.
async function transcribe(env, audioBuf, filename) {
  const form = new FormData();
  form.append("file", new Blob([audioBuf]), filename || "audio.ogg");
  form.append("model", "whisper-1");
  form.append("language", "ko");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "authorization": "Bearer " + env.OPENAI_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("STT fail", res.status, t);
    // verbose_json 실패 시 gpt-4o-transcribe 텍스트로 폴백
    return await transcribeFallback(env, audioBuf, filename);
  }
  let data;
  try { data = await res.json(); } catch (e) { return { plain: "", timed: "" }; }
  // 세그먼트를 [mm:ss] 텍스트 형태로 — 시간 흐름·전환을 요약 LLM이 보게.
  if (data.segments && data.segments.length) {
    const fmt = function (sec) {
      const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      return ("0" + m).slice(-2) + ":" + ("0" + s).slice(-2);
    };
    const lines = data.segments.map(function (seg) {
      return "[" + fmt(seg.start) + "] " + String(seg.text || "").trim();
    });
    const plain = String(data.text || "").trim();
    if (looksBadTranscript(plain)) {
      console.error("STT bad transcript, retry fallback");
      return await transcribeFallback(env, audioBuf, filename);
    }
    return { plain, timed: lines.join("\n") };
  }
  const plain = String(data.text || "").trim();
  if (looksBadTranscript(plain)) {
    console.error("STT bad transcript, retry fallback");
    return await transcribeFallback(env, audioBuf, filename);
  }
  return { plain, timed: plain };
}

// 폴백: verbose_json 미지원/실패 시 gpt-4o-transcribe 텍스트.
async function transcribeFallback(env, audioBuf, filename) {
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
  if (!res.ok) throw new Error("STT failed " + res.status);
  const t = (await res.text()).trim();
  if (looksBadTranscript(t)) throw new Error("STT produced unusable transcript");
  return { plain: t, timed: t };
}

const VOICE_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래는 회의/간담회 녹음을 받아쓴 전문(全文)이다. 이것은 요약이 아니라 회의록이다. 염 사장이 회의에 안 들어가고도 논의 흐름, 쟁점, 결정, 후속 조치를 복원할 수 있도록 충실하고 상세하게 작성하라.\n\n" +
  "[원칙]\n" +
  "- '요약'이라는 제목이나 표현을 쓰지 마라. 출력물의 성격은 반드시 '회의록'이다.\n" +
  "- 짧게 줄이지 마라. 제목·개요만 쓰지 말고, 실제로 오간 내용을 안건별로 구체적으로 담아라.\n" +
  "- 발화자가 여러 명이면 화자별로 누가 어떤 입장·의견을 냈는지 구분하라. 이름이 안 나오면 화자A·화자B·화자C로 구분하되, 직책·맥락으로 추정되면 (추정) 표기와 함께 명시하라.\n" +
  "- 받아쓰기에 없는 내용을 지어내지 마라. 불명확하면 '불명확'으로 표기하라.\n" +
  "- 숫자·날짜·금액·고유명사(인명·기관·프로젝트명)는 빠짐없이 그대로 살려라.\n" +
  "- 확정된 결정과 검토/논의 중인 사항을 반드시 구분하라.\n" +
  "- Action Item은 담당자, 해야 할 일, 기한이 들리면 반드시 분리해 적어라.\n\n" +
  "[출력 형식] HTML bold 사용. 섹션 제목과 순서는 반드시 유지. 각 섹션 사이 빈 줄.\n\n" +
  "📝 <b>녹음 회의록</b>\n\n" +
  "📅 <b>회의 정보</b>\n• 일시: {녹음에서 확인되면 기재, 없으면 불명확}\n• 장소/방식: {확인되면 기재, 없으면 불명확}\n• 회의 성격: {회의/간담회/보고/논의 등}\n\n" +
  "👥 <b>참석·발화자</b>\n• <b>{이름/직책}</b>: {역할 또는 발언 맥락}\n• <b>화자A</b>: {이름 불명확 시 역할/입장}\n\n" +
  "🗂 <b>논의 안건</b>\n• {안건 1}\n• {안건 2}\n• {안건 3}\n\n" +
  "💬 <b>상세 회의록</b>\n• <b>{안건 1}</b>: {논의 배경, 주요 발언, 쟁점, 반론, 우려, 정리 방향을 상세히}\n• <b>{안건 2}</b>: {같은 방식으로 상세히}\n\n" +
  "✅ <b>결정사항</b>\n• {확정된 결정만. 없으면 '확정된 결정 없음'}\n\n" +
  "📌 <b>후속 조치</b>\n• {담당자}: {해야 할 일} / {기한 또는 시점}\n• {담당·기한이 불명확하면 불명확으로 표시}\n\n" +
  "⚠️ <b>확인 필요</b>\n• {염 사장이 확인하거나 보고받아야 할 내용}\n\n" +
  "🗒 <b>주요 발언</b>\n• <b>{화자}</b>: \"{회의록에 필요한 핵심 발언을 원문 취지에 가깝게}\"";

// 녹음 메시지에서 오디오 객체 추출 (mime 또는 파일 확장자로 판별).
export function pickAudio(msg) {
  if (msg.voice) return msg.voice;
  if (msg.audio) return msg.audio;
  if (msg.document) {
    const mime = msg.document.mime_type || "";
    const name = msg.document.file_name || "";
    if (/audio/i.test(mime) || /\.(ogg|oga|mp3|m4a|wav|aac|opus|flac|amr)$/i.test(name)) return msg.document;
  }
  return null;
}

export async function handleVoice(env, chatId, msg, replyToUser = false) {
  const voice = pickAudio(msg);
  if (!voice) return;
  if (voice.file_size && voice.file_size > 25 * 1024 * 1024) {
    return sendMessage(env, chatId, "녹음 파일이 너무 큽니다 (25MB 초과). 잘라서 보내주세요.");
  }

  if (replyToUser) await sendMessage(env, chatId, "🎙 녹음을 받아쓰고 회의록을 작성하는 중입니다...");

  let transcript, transcriptTimed, audioBuf;
  try {
    const url = await getFileUrl(env, voice.file_id);
    audioBuf = await (await fetch(url)).arrayBuffer();
    const tr = await transcribe(env, audioBuf, voice.file_name || "audio.ogg");
    transcript = tr.plain;
    transcriptTimed = tr.timed;
  } catch (e) {
    console.error("voice transcribe error", e && e.message);
    return sendMessage(env, chatId, "받아쓰기에 실패했습니다. 다시 시도해 주세요.");
  }
  if (!transcript) return sendMessage(env, chatId, "음성에서 텍스트를 추출하지 못했습니다.");

  // 분류(프로젝트/카테고리) — insight 저장 + 캡션 #해시태그 우선.
  const sender = senderName(msg);
  const filename = voice.file_name || "voice.m4a";
  let meta = { category: "", project: "", filename, sender, isPhoto: false };
  try {
    const ins = await extractInsight(env, {
      chatId: msg.chat.id,
      sourceType: "voice",
      sourceRef: voice.file_id,
      text: transcript,
      sender,
      senderId: senderId(msg),
      caption: msg.caption || "",
      filename,
      receivedAt: msg.date ? new Date(msg.date * 1000) : new Date(),
    });
    if (ins && typeof ins === "object") { meta.category = ins.category || ""; meta.project = ins.project || ""; }
  } catch (e) {
    console.error("voice extractInsight error", e && e.message);
  }
  try {
    const kws = await loadProjectKeywords(env);
    const tagProj = captionProject(kws, msg.caption || "");
    if (tagProj) { meta.project = tagProj; meta.category = ""; }
  } catch (e) {
    console.error("voice captionProject error", e && e.message);
  }

  // R2 자동 백업 — 원본 음성을 분류 폴더에 영구 보존.
  let r2Key = "";
  try {
    if (env.R2 && audioBuf) {
      r2Key = buildR2Key(meta);
      await env.R2.put(r2Key, audioBuf, {
        customMetadata: { category: meta.category || "", project: meta.project || "", sender: sender || "", filename },
      });
    }
  } catch (e) {
    console.error("voice R2 upload error", e && e.message);
  }

  // D1 files 저장 — sender·r2_key·전사 텍스트 (saveFile 로 통일).
  try {
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: voice.file_id,
      r2_key: r2Key,
      filename,
      text: transcript.slice(0, 5000),
      sender,
    });
  } catch (e) {
    console.error("voice save error", e && e.message);
  }

  if (!replyToUser) return; // silent store only
  const transcriptForMinutes = (transcriptTimed || transcript || "").slice(0, 16000);
  try {
    const minutes = await callClaude(env, "아래는 [시간] 발화 형식의 받아쓰기 전문이다. 시간 흐름과 발화 전환을 참고해 회의록을 작성하라.\n\n" + transcriptForMinutes, VOICE_SYSTEM, MODEL_SMART, 4000);
    await sendMessage(env, chatId, minutes);
  } catch (e) {
    console.error("voice minutes error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "회의록 작성 중 오류가 발생했습니다. 받아쓰기는 저장했습니다. 다시 '회의록 작성'이라고 답장해 주세요.");
  }
}
