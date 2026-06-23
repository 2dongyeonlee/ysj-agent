// voice.js — voice note -> STT (OpenAI whisper-1 verbose, fallback gpt-4o-transcribe)
//            -> 분류·R2 백업·저장 -> 회의록 작성 -> Telegram.
// STT provider isolated in transcribe() for later swap (e.g. CLOVA).

import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage, senderName } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
import { extractInsight } from "./insight.js";
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

function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(function () { controller.abort("timeout"); }, ms);
  return controller.signal;
}

async function transcribeTextModel(env, audioBuf, filename, model, timeoutMs) {
  const signal = timeoutSignal(timeoutMs || 25000);
  const form = new FormData();
  form.append("file", new Blob([audioBuf]), filename || "audio.ogg");
  form.append("model", model);
  form.append("language", "ko");
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "authorization": "Bearer " + env.OPENAI_API_KEY },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(model + " STT failed " + res.status + ": " + (await res.text()).slice(0, 300));
  const t = (await res.text()).trim();
  if (looksBadTranscript(t)) throw new Error("STT produced unusable transcript");
  return { plain: t, timed: t };
}

// STT. timeoutMs 로 모델별 제한시간을 조절(큐는 넉넉히, 웹훅은 짧게).
async function transcribe(env, audioBuf, filename, timeoutMs) {
  const t = timeoutMs || 24000;
  try {
    return await transcribeTextModel(env, audioBuf, filename, "gpt-4o-transcribe", t);
  } catch (e) {
    console.error("gpt-4o-transcribe error", e && e.message);
    if (/abort|timeout/i.test(String((e && (e.name || e.message)) || ""))) throw e;
  }
  try {
    return await transcribeTextModel(env, audioBuf, filename, "gpt-4o-mini-transcribe", t);
  } catch (e) {
    console.error("gpt-4o-mini-transcribe error", e && e.message);
    if (/abort|timeout/i.test(String((e && (e.name || e.message)) || ""))) throw e;
  }
  return await transcribeTextModel(env, audioBuf, filename, "whisper-1", t);
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

// 녹음 접수 — STT는 여기서 하지 않는다. R2에 원본을 저장하고 files 행을 '대기'(text='')로 남긴 뒤
// 즉시 반환한다. 실제 받아쓰기는 매분 도는 Cron(runVoiceQueue)이 처리한다.
// (긴 녹음 STT는 웹훅 백그라운드 실행 한도를 넘겨 멈추므로, 실행시간이 긴 Cron으로 분리.)
export async function handleVoice(env, chatId, msg, replyToUser = false) {
  const voice = pickAudio(msg);
  if (!voice) return;
  if (voice.file_size && voice.file_size > 20 * 1024 * 1024) {
    return sendMessage(env, chatId, "녹음 파일이 너무 큽니다 (텔레그램 봇 한계 20MB). 10분 내외로 잘라 보내주세요.");
  }

  const sender = senderName(msg);
  const filename = voice.file_name || "voice.m4a";
  const meta = { category: "", project: "", filename, sender, isPhoto: false };
  let audioBuf, r2Key = "";
  try {
    const url = await getFileUrl(env, voice.file_id);
    audioBuf = await (await fetch(url)).arrayBuffer();
  } catch (e) {
    console.error("voice download error", e && e.message);
    return sendMessage(env, chatId, "녹음 파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  // 원본을 R2에 저장하고 files 행을 대기 상태(text='')로 남긴다.
  try {
    if (env.R2 && audioBuf) {
      r2Key = buildR2Key(meta);
      await env.R2.put(r2Key, audioBuf, {
        customMetadata: { category: "", project: "", sender: sender || "", filename },
      });
    }
    // (file_id, chat_id) 기준 — 같은 녹음을 여러 방에 전달하면 file_id 가 같으므로
    // chat_id 까지 봐야 방마다 자기 행이 생긴다(전사를 올린 방으로 돌려보내기 위함).
    const upd = await env.DB.prepare(
      "UPDATE files SET r2_key = ?, sender = ? WHERE file_id = ? AND chat_id = ?"
    ).bind(r2Key, sender, voice.file_id, String(msg.chat.id)).run();
    if (!upd.meta || !upd.meta.changes) {
      await saveFile(env, {
        chat_id: msg.chat.id,
        file_id: voice.file_id,
        r2_key: r2Key,
        filename,
        text: "",
        sender,
      });
    }
  } catch (e) {
    console.error("voice enqueue save error", e && e.message);
  }

  if (replyToUser) {
    await sendMessage(env, chatId,
      "🎙 녹음을 받았습니다. 받아쓰는 중이며 1~2분 내 전사가 도착합니다. (긴 녹음일수록 조금 더 걸려요)\n" +
      "전사가 오면 '회의록' 또는 /minutes 로 회의록을 받을 수 있습니다.");
  }
}

const VOICE_AUDIO_LIKE =
  "(filename LIKE '%.m4a' OR filename LIKE '%.ogg' OR filename LIKE '%.oga' " +
  "OR filename LIKE '%.mp3' OR filename LIKE '%.wav' OR filename LIKE '%.aac' " +
  "OR filename LIKE '%.opus' OR filename LIKE '%.amr' OR filename LIKE '%.flac' " +
  "OR filename LIKE '%voice%' OR filename LIKE '%녹음%')";

// 매분 Cron 이 호출 — 대기 중인 녹음 1건을 받아쓰기. Cron 핸들러는 웹훅보다 실행시간이 길어
// 긴 녹음도 처리 가능. 동시 실행은 KV 락으로 막고, 반복 실패는 시도 횟수로 끊는다.
export async function runVoiceQueue(env) {
  if (await env.STATE.get("vq:lock")) return; // 이미 처리 중
  await env.STATE.put("vq:lock", "1", { expirationTtl: 170 });
  try {
    // 1) 회의록 작성 대기 작업 우선 처리(사용자가 기다리는 중). 한 번에 1건.
    const mj = await env.STATE.list({ prefix: "mj:" });
    if (mj.keys && mj.keys.length) {
      const key = mj.keys[0].name;
      await env.STATE.delete(key);
      await generateMinutes(env, key.slice(3)); // "mj:" 제거 → chatId
      return;
    }

    // 2) 받아쓰기 대기 처리. 오래된 순으로 후보를 보되, 최근 시도한 행은 건너뛴다
    //    — 길거나 실패하는 한 건이 큐 전체(특히 다른 방 녹음)를 막지 않도록(공정성).
    const cands = (await env.DB.prepare(
      "SELECT id, chat_id, file_id, r2_key, filename, sender FROM files " +
      "WHERE (text IS NULL OR text = '') AND r2_key != '' AND " + VOICE_AUDIO_LIKE + " " +
      "AND created_at >= datetime('now','-2 hours') ORDER BY id ASC LIMIT 6"
    ).all()).results || [];
    let row = null;
    for (const c of cands) {
      if (await env.STATE.get("vq:cool:" + c.id)) continue; // 최근 시도함 → 다음 기회에
      row = c;
      break;
    }
    if (!row) return;
    const chatId = row.chat_id;
    await env.STATE.put("vq:cool:" + row.id, "1", { expirationTtl: 240 }); // 4분 쿨다운

    // 반복 실패 차단 — 2회 시도 후 sentinel 저장하고 안내(더는 대기 대상이 아님).
    const attKey = "vq:att:" + row.id;
    const att = parseInt((await env.STATE.get(attKey)) || "0", 10);
    if (att >= 2) {
      await env.DB.prepare("UPDATE files SET text = ? WHERE id = ?").bind("[받아쓰기 실패]", row.id).run();
      await sendMessage(env, chatId, "받아쓰기에 반복 실패했습니다. 녹음이 너무 길거나 음질/형식 문제일 수 있어요. 10분 이내로 나눠 다시 보내주세요. (원본은 저장돼 있습니다)");
      return;
    }
    await env.STATE.put(attKey, String(att + 1), { expirationTtl: 86400 });

    // R2에서 원본 로드.
    let audioBuf;
    try {
      const obj = await env.R2.get(row.r2_key);
      if (!obj) {
        await env.DB.prepare("UPDATE files SET text = ? WHERE id = ?").bind("[받아쓰기 실패: 원본 없음]", row.id).run();
        return;
      }
      audioBuf = await obj.arrayBuffer();
    } catch (e) {
      console.error("voice queue R2 load error", row.id, e && e.message);
      return; // 다음 분에 재시도
    }

    // STT — Cron 이라 넉넉한 타임아웃 사용.
    let transcript = "";
    try {
      const tr = await transcribe(env, audioBuf, row.filename, 150000);
      transcript = (tr.plain || "").trim();
    } catch (e) {
      console.error("voice queue STT error", row.id, e && e.message);
      return; // att 증가됨 → 다음 분 재시도, 2회 후 실패 처리
    }
    if (!transcript) return;

    // 전사 저장.
    try {
      await env.DB.prepare("UPDATE files SET text = ? WHERE id = ?")
        .bind(transcript.slice(0, 16000), row.id).run();
    } catch (e) { console.error("voice queue save error", row.id, e && e.message); }

    // 분류(insight) — 실패해도 전사는 이미 저장됨.
    try {
      await extractInsight(env, {
        chatId, sourceType: "voice", sourceRef: row.file_id, text: transcript,
        sender: row.sender || "", senderId: "", caption: "", filename: row.filename, receivedAt: new Date(),
      });
    } catch (e) { console.error("voice queue extractInsight error", row.id, e && e.message); }

    // 전사 전송 + 회의록 안내.
    const head = transcript.slice(0, 3500);
    await sendMessage(env, chatId,
      "🎙 받아쓰기 완료 (전문은 저장됨):\n\n" + head +
      (transcript.length > 3500 ? "\n\n…(이하 생략)" : "") +
      "\n\n📝 회의록이 필요하면 '회의록' 또는 /minutes 라고 보내주세요.");
  } finally {
    await env.STATE.delete("vq:lock");
  }
}

// 저장된 최근 녹음 전사 조회.
async function latestTranscript(env, chatId) {
  try {
    return await env.DB.prepare(
      "SELECT filename, text FROM files WHERE chat_id = ? AND text != '' AND text NOT LIKE '[받아쓰기 실패%' " +
      "AND (filename LIKE '%.m4a' OR filename LIKE '%.ogg' OR filename LIKE '%.oga' " +
      "OR filename LIKE '%.mp3' OR filename LIKE '%.wav' OR filename LIKE '%voice%' OR filename LIKE '%녹음%') " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(String(chatId)).first();
  } catch (e) { console.error("minutes query error", e && e.message); return null; }
}

// 회의록 요청 접수 — 생성은 여기서 하지 않는다. 전사 존재만 확인하고 작업을 큐(KV)에 넣은 뒤
// 즉시 안내한다. 실제 회의록 생성(LLM)은 매분 Cron(generateMinutes)이 처리한다.
// (긴 전사의 회의록 생성도 웹훅 백그라운드 한도를 넘겨 멈추므로 Cron으로 분리.)
export async function makeMinutesFromStored(env, chatId) {
  const row = await latestTranscript(env, chatId);
  if (!row || !row.text) {
    return sendMessage(env, chatId, "최근 받아쓰기를 찾지 못했습니다. 녹음을 먼저 보내주세요.");
  }
  await env.STATE.put("mj:" + chatId, String(Date.now()), { expirationTtl: 3600 });
  return sendMessage(env, chatId, "📝 회의록을 작성하는 중입니다... 1~2분 내 도착합니다.");
}

// Cron 이 호출 — 저장된 전사로 회의록을 생성해 전송.
export async function generateMinutes(env, chatId) {
  const row = await latestTranscript(env, chatId);
  if (!row || !row.text) {
    return sendMessage(env, chatId, "최근 받아쓰기를 찾지 못했습니다. 녹음을 먼저 보내주세요.");
  }
  try {
    const minutes = await callClaude(env,
      "아래는 회의/간담회 받아쓰기 전문이다. 위 형식에 따라 충실한 회의록을 작성하라.\n\n" + String(row.text).slice(0, 16000),
      VOICE_SYSTEM, MODEL_SMART, 3500);
    await sendMessage(env, chatId, minutes);
  } catch (e) {
    console.error("generateMinutes error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "회의록 작성에 실패했습니다. 잠시 후 다시 '회의록'이라고 보내주세요.");
  }
}
