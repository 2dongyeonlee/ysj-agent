// voice.js — voice note -> STT (OpenAI whisper-1 verbose, fallback gpt-4o-transcribe)
//            -> 분류·R2 백업·저장 -> Claude 리치 요약 -> Telegram.
// STT provider isolated in transcribe() for later swap (e.g. CLOVA).

import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage, senderName } from "./telegram.js";
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

// OpenAI 최대 활용: whisper-1 + verbose_json 으로 세그먼트(시간) 확보.
// 화자 분리는 OpenAI 미지원이나, 시간 세그먼트가 발화 전환 추정 단서가 된다.
async function transcribe(env, audioBuf, filename) {
  const form = new FormData();
  form.append("file", new Blob([audioBuf]), filename || "audio.ogg");
  form.append("model", "whisper-1");
  form.append("language", "ko");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("prompt", STT_PROMPT);
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
    return { plain: String(data.text || "").trim(), timed: lines.join("\n") };
  }
  return { plain: String(data.text || "").trim(), timed: String(data.text || "").trim() };
}

// 폴백: verbose_json 미지원/실패 시 gpt-4o-transcribe 텍스트.
async function transcribeFallback(env, audioBuf, filename) {
  const form = new FormData();
  form.append("file", new Blob([audioBuf]), filename || "audio.ogg");
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ko");
  form.append("response_format", "text");
  form.append("prompt", STT_PROMPT);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "authorization": "Bearer " + env.OPENAI_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error("STT failed " + res.status);
  const t = (await res.text()).trim();
  return { plain: t, timed: t };
}

const VOICE_SYSTEM = PERSONA_STYLE + "\n\n" +
  "[작업] 아래는 회의/간담회 녹음을 받아쓴 전문(全文)이다. 염 사장이 회의에 안 들어가고도 전체를 파악할 수 있도록 충실하고 상세하게 정리하라.\n\n" +
  "[원칙]\n" +
  "- 절대 짧게 줄이지 마라. 제목·개요만 쓰지 말고, 오간 내용을 구체적으로 담아라.\n" +
  "- 발화자가 여러 명이면 화자별로 누가 어떤 입장·의견을 냈는지 구분하라. 이름이 안 나오면 화자A·화자B·화자C로 구분하되, 직책·맥락으로 추정되면 (추정) 표기와 함께 명시하라.\n" +
  "- 받아쓰기에 없는 내용을 지어내지 마라. 불명확하면 '불명확'으로 표기하라.\n" +
  "- 숫자·날짜·금액·고유명사(인명·기관·프로젝트명)는 빠짐없이 그대로 살려라.\n\n" +
  "[출력 형식] (HTML 볼드, 섹션 사이 빈 줄. 각 항목은 충분히 길게, 불릿 여러 개 허용)\n\n" +
  "🎙 <b>녹음 요약</b>\n\n" +
  "📅 <b>일시·장소·맥락</b>\n• {언제, 어디서, 무슨 자리인지. 회의 성격}\n\n" +
  "🗂 <b>주요 안건</b>\n• {다뤄진 안건을 항목별로 나열. 안건마다 한 줄씩}\n\n" +
  "🗣 <b>발화자별 입장·의견</b>\n• <b>{화자/직책}</b>: {그가 낸 핵심 주장·의견·우려를 구체적으로. 한 명이 여러 발언이면 여러 불릿}\n\n" +
  "💬 <b>안건별 논의 내용</b>\n• <b>{안건1}</b>: {찬반·쟁점·오간 논의를 상세히}\n• <b>{안건2}</b>: {...}\n\n" +
  "✅ <b>의사결정 사항</b>\n• {확정된 결정. 없으면 '확정된 결정 없음, 검토 단계'}\n\n" +
  "📌 <b>Action Item</b>\n• {누가 / 무엇을 / 언제까지. 담당·기한 최대한 명시. 여러 개면 모두}\n\n" +
  "⚠️ <b>확인·보고 필요</b>\n• {염 사장이 추가 확인하거나 보고해야 할 사항}\n\n" +
  "🗒 <b>발언 전문(주요 부분)</b>\n{핵심 발언을 발화자 표시와 함께 길게 발췌}";

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
  if (replyToUser) await sendMessage(env, chatId, "🎙 녹음을 받아쓰는 중입니다...");

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
  const forSummary = (transcriptTimed || transcript || "").slice(0, 16000);
  const summary = await callClaude(env, "아래는 [시간] 발화 형식의 받아쓰기 전문이다. 시간 흐름과 발화 전환을 참고해 발화자를 추정하라.\n\n" + forSummary, VOICE_SYSTEM, MODEL_SMART, 4000);
  await sendMessage(env, chatId, summary);
}
