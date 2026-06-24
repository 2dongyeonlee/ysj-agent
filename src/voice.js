// voice.js — voice note -> STT (OpenAI whisper-1 verbose, fallback gpt-4o-transcribe)
//            -> 분류·R2 백업·저장 -> 회의록 작성 -> Telegram.
// STT provider isolated in transcribe() for later swap (e.g. CLOVA).

import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage, senderName } from "./telegram.js";
import { PERSONA_STYLE } from "./persona.js";
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
  "- 안건별 요지는 핵심만 압축하되, 결정사항과 미결사항은 절대 빠뜨리지 마라. 발화자 중계식 나열을 금지한다.\n" +
  "- 발화자가 여러 명이면 화자별로 누가 어떤 입장·의견을 냈는지 구분하라. 이름이 안 나오면 화자A·화자B·화자C로 구분하되, 직책·맥락으로 추정되면 (추정) 표기와 함께 명시하라.\n" +
  "- 받아쓰기에 없는 내용을 지어내지 마라. 불명확하면 '불명확'으로 표기하라.\n" +
  "- 숫자·날짜·금액·고유명사(인명·기관·프로젝트명)는 빠짐없이 그대로 살려라.\n" +
  "- 확정된 결정과 검토/논의 중인 사항을 반드시 구분하라.\n" +
  "- Action Item은 담당자, 해야 할 일, 기한이 들리면 반드시 분리해 적어라.\n" +
  "- 모든 안건은 \"→ 결정:\" 또는 \"→ 미결:\"로 결론을 명시해 닫아라. 결론 없는 나열을 금지한다.\n\n" +
  "[출력 형식] HTML 태그 <b>,<u> 만 사용. 부등호(<,>)를 본문 텍스트에 쓰지 말 것. 이모지를 쓰지 말 것. 섹션 순서 반드시 유지. 각 섹션 사이 빈 줄.\n" +
  "[강조 규칙]\n" +
  "- <b>: 섹션 헤더, 안건명, 결정 결과 동사(발주/확정/안 함 등). 골격 식별용.\n" +
  "- <u>: 날짜·기한·금액, 사장이 결정·확인해야 할 미결 항목. 행동 신호용.\n" +
  "- 한 줄에 강조는 최대 2개. 인명·일반명사는 강조하지 않는다.\n\n" +
  "<b>녹음 회의록 · {일시 또는 추정}</b>\n\n" +
  "<b>한 줄</b>\n• 확정 {N}건 / 사장 결정 필요 {M}건 — 핵심 1줄(미결은 <u>밑줄</u>)\n\n" +
  "━━━━━━━━━\n" +
  "■ <b>안건별 요지</b>\n• <b>{안건}</b>: {배경·쟁점 압축} → 결정: {결론} 또는 → <u>미결</u>: {남은 것}\n\n" +
  "━━━━━━━━━\n" +
  "■ <b>결정·확정</b>\n• {확정된 것만. 결과 동사는 <b>로. 없으면 '확정 없음'}\n\n" +
  "━━━━━━━━━\n" +
  "■ <b>후속 조치</b>\n• {담당자}: {할 일} / <u>{기한·시점}</u>\n\n" +
  "━━━━━━━━━\n" +
  "■ <b>참석</b>\n• {화자/직책 — 참고용, 짧게}";

const MEETING_JSON_SYSTEM = PERSONA_STYLE + "\n\n" +
  "아래 받아쓰기 전문을 읽고 JSON만 반환하라. 마크다운 코드블록 금지.\n" +
  "반환 스키마는 정확히 {\"short\":\"...\",\"full\":\"...\"} 이다.\n\n" +
  "[공통 원칙]\n" +
  "- 임원이 사장에게 올리는 보고용 회의록이다. 발화 복원·중복·군더더기 금지, 결론 중심으로 간결히.\n" +
  "- 이모지·마크다운(**, ##)·표 금지. HTML <b>만 사용. 헤더는 ■ <b>제목</b> 형식. 구분선은 ━━━━━━━━━━━━━━━━━━ 만.\n" +
  "- 추측 금지. 자료에 없으면 항목을 비우고, 핵심에 영향 주는 미결만 '미결:'로 1줄.\n\n" +
  "[short 규칙] 텔레그램 즉시 표시용. 사장이 30초 내 읽을 분량. '요약'이라는 단어를 쓰지 않는다.\n" +
  "형식(이 순서 고정):\n" +
  "[회의 제목]\n" +
  "■ <b>일시</b> 명시된 날짜·시간, 없으면 미상\n" +
  "■ <b>참석</b> 참석자·소속, 없으면 미상\n" +
  "■ <b>배경</b> 맥락 1줄\n" +
  "━━━━━━━━━━━━━━━━━━\n" +
  "■ <b>사장 결정 필요</b>\n" +
  "- 사장이 직접 판단할 항목만. 없으면 이 섹션 자체를 생략\n\n" +
  "■ <b>안건</b>\n" +
  "1. 안건명\n" +
  "   내용: 핵심 논의·배경·쟁점 2~3줄(숫자·고유명사 포함)\n" +
  "   → 결정: 확정된 것  또는  → 미결: 남은 것\n\n" +
  "■ <b>후속조치</b>\n" +
  "- 담당/기한 있는 액션만. 없으면 '없음'\n" +
  "━━━━━━━━━━━━━━━━━━\n" +
  "전체 회의록 필요 시 /minutes\n\n" +
  "[full 규칙] 상세 회의록이되 보고용으로 간결. short 와 같은 구조·순서를 따른다.\n" +
  "- 맨 위 한 줄 핵심(Bottom Line)\n" +
  "- 이어서 ■ <b>사장 결정 필요</b>(있을 때만) → ■ <b>안건</b> → ■ <b>후속조치</b>\n" +
  "- 각 안건은 '안건명 / 내용(논의·배경·쟁점) / → 결정 또는 → 미결' 구조를 지킨다.\n" +
  "- short 대비 각 안건의 '내용'을 더 충실히(쟁점·수치·관계자 포함) 쓰되, 발언 나열·중복은 금지하고 안건당 4~6줄을 넘기지 않는다.";

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
      "UPDATE files SET r2_key = ?, sender = ?, doc_type = 'meeting' WHERE file_id = ? AND chat_id = ?"
    ).bind(r2Key, sender, voice.file_id, String(msg.chat.id)).run();
    if (!upd.meta || !upd.meta.changes) {
      await saveFile(env, {
        chat_id: msg.chat.id,
        file_id: voice.file_id,
        r2_key: r2Key,
        filename,
        text: "",
        sender,
        doc_type: "meeting",
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

function minutesTargetChat(env, fallbackChatId) {
  return String((env && env.BRIEFING_TARGET_ID) || fallbackChatId || "");
}

// 매분 Cron 이 호출 — 대기 중인 녹음 1건을 받아쓰기. Cron 핸들러는 웹훅보다 실행시간이 길어
// 긴 녹음도 처리 가능. 동시 실행은 KV 락으로 막고, 반복 실패는 시도 횟수로 끊는다.
export async function runVoiceQueue(env) {
  if (await env.STATE.get("vq:lock")) return; // 이미 처리 중
  await env.STATE.put("vq:lock", "1", { expirationTtl: 300 });
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
      "AND NOT EXISTS (SELECT 1 FROM files f2 WHERE f2.file_id = files.file_id AND f2.text != '') " +
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
    await env.STATE.put("vq:cool:" + row.id, "1", { expirationTtl: 360 }); // 6분 쿨다운

    // 반복 실패 차단 — 2회 시도 후 sentinel 저장하고 안내(더는 대기 대상이 아님).
    const attKey = "vq:att:" + row.id;
    const att = parseInt((await env.STATE.get(attKey)) || "0", 10);
    if (att >= 2) {
      await env.DB.prepare("UPDATE files SET text = ?, doc_type = 'meeting' WHERE id = ?").bind("[받아쓰기 실패]", row.id).run();
      await sendMessage(env, chatId, "받아쓰기에 반복 실패했습니다. 녹음이 너무 길거나 음질/형식 문제일 수 있어요. 10분 이내로 나눠 다시 보내주세요. (원본은 저장돼 있습니다)");
      return;
    }
    await env.STATE.put(attKey, String(att + 1), { expirationTtl: 86400 });

    // R2에서 원본 로드.
    let audioBuf;
    try {
      const obj = await env.R2.get(row.r2_key);
      if (!obj) {
        await env.DB.prepare("UPDATE files SET text = ?, doc_type = 'meeting' WHERE id = ?").bind("[받아쓰기 실패: 원본 없음]", row.id).run();
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
      const tr = await transcribe(env, audioBuf, row.filename, 280000); // Cron은 시간 여유 큼 → 긴 녹음 대비
      transcript = (tr.plain || "").trim();
    } catch (e) {
      console.error("voice queue STT error", row.id, e && e.message);
      return; // att 증가됨 → 다음 분 재시도, 2회 후 실패 처리
    }
    if (!transcript) return;

    let minutes = { short: "", full: null };
    try {
      minutes = await createMeetingMinutes(env, transcript);
    } catch (e) {
      console.error("createMeetingMinutes error", row.id, e && e.message);
      minutes = { short: fallbackShortMinutes(transcript), full: null };
    }

    try {
      await env.DB.prepare("UPDATE files SET text = ?, doc_type = 'meeting', full_minutes = ? WHERE id = ?")
        .bind(transcript.slice(0, 16000), minutes.full || null, row.id).run();
    } catch (e) { console.error("voice queue save error", row.id, e && e.message); }

    if (!minutes.full) {
      try {
        const retry = await createMeetingMinutes(env, transcript);
        minutes = {
          short: retry.short || minutes.short || fallbackShortMinutes(transcript),
          full: retry.full || retry.short || minutes.short || fallbackShortMinutes(transcript),
        };
        await env.DB.prepare("UPDATE files SET doc_type = 'meeting', full_minutes = ? WHERE id = ?")
          .bind(minutes.full, row.id).run();
      } catch (e) {
        console.error("createMeetingMinutes retry error", row.id, e && e.message);
        minutes.full = minutes.short || fallbackShortMinutes(transcript);
        await env.DB.prepare("UPDATE files SET doc_type = 'meeting', full_minutes = ? WHERE id = ?")
          .bind(minutes.full, row.id).run();
      }
    }

    try {
      await saveMeetingInsight(env, {
        chatId,
        sourceRef: row.file_id,
        summary: minutes.short,
        sender: row.sender || "",
        inputChars: transcript.length,
      });
    } catch (e) { console.error("voice queue saveMeetingInsight error", row.id, e && e.message); }

    const targetChatId = minutesTargetChat(env, chatId);
    const out = await withMetaFollowup(env, targetChatId, row.file_id, minutes.short || fallbackShortMinutes(transcript));
    await sendMessage(env, targetChatId, out);
  } finally {
    await env.STATE.delete("vq:lock");
  }
}

function parseJsonObject(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("meeting JSON parse failed");
}

function fallbackShortMinutes(transcript) {
  const first = String(transcript || "").replace(/\s+/g, " ").trim().slice(0, 240);
  return [
    "회의 내용 확인",
    "━━━━━━━━━━━━━━━━━━",
    "■ <b>결정 필요</b>",
    "- 없음",
    "",
    "■ <b>안건</b>",
    "1. 회의 내용 — " + (first || "전사 내용 확인 필요"),
    "   → 미결: 상세 회의록 생성 필요",
    "",
    "■ <b>후속조치</b>",
    "- 없음",
    "━━━━━━━━━━━━━━━━━━",
    "전체 회의록 필요 시 /minutes",
  ].join("\n");
}

const ASK_META = "\n\n■ <b>보강 안내</b>\n날짜·참석 명단·주요 아젠다를 알려주시면 회의록에 반영해 다시 작성해 드립니다.\n예) 6/23, 염성진·권오혁·이동연, 안건: AX 전략";

export async function withMetaFollowup(env, chatId, fileId, minutesText) {
  let out = String(minutesText || "");
  if (/미상|미정/.test(out)) {
    if (fileId) {
      await env.STATE.put("mctx:" + chatId, String(fileId), { expirationTtl: 1800 });
    }
    out += ASK_META;
  }
  return out;
}

export async function createMeetingMinutes(env, transcript) {
  const raw = await callClaude(env,
    "받아쓰기 전문:\n" + String(transcript || "").slice(0, 16000),
    MEETING_JSON_SYSTEM,
    MODEL_SMART,
    2800
  );
  let parsed;
  try {
    parsed = parseJsonObject(raw);
  } catch (e) {
    console.error("meeting minutes JSON parse error", e && e.message);
    return { short: String(raw || "").slice(0, 1200).trim() || fallbackShortMinutes(transcript), full: null };
  }
  const short = String(parsed.short || "").trim() || fallbackShortMinutes(transcript);
  const full = String(parsed.full || "").trim() || null;
  return { short, full };
}

// 녹음 없이 최근 텍스트 대화를 묶어 회의록으로 정리. 슬래시 명령은 제외.
export async function summarizeRecentMessages(env, chatId, n) {
  const lim = Math.max(1, Math.min(parseInt(n, 10) || 30, 100));
  let results;
  try {
    ({ results } = await env.DB.prepare(
      "SELECT sender, text FROM messages WHERE chat_id = ? AND text != '' " +
      "AND text NOT LIKE '/%' ORDER BY id DESC LIMIT ?"
    ).bind(String(chatId), lim).all());
  } catch (e) {
    console.error("summarizeRecentMessages query error", e && e.message);
    return sendMessage(env, chatId, "메시지를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
  if (!results || !results.length) return sendMessage(env, chatId, "요약할 최근 대화가 없습니다.");
  const merged = results.reverse()
    .map(function (r) { return (r.sender ? r.sender + ": " : "") + r.text; })
    .join("\n");
  if (merged.length < 30) return sendMessage(env, chatId, "요약할 내용이 충분하지 않습니다.");
  // 회의록 생성(LLM)은 웹훅 백그라운드 시간초과 위험 → KV에 싣고 매분 Cron이 처리.
  await env.STATE.put("tmin:" + chatId, merged.slice(0, 16000), { expirationTtl: 1800 });
  return sendMessage(env, chatId,
    "📝 최근 " + results.length + "개 대화로 회의록을 작성하는 중입니다... 1~2분 후 도착합니다.");
}

// Cron 이 호출 — 대기 중인 텍스트 회의록 작업(tmin:*)을 생성해 전송.
export async function runTextMinutesQueue(env) {
  let jobs;
  try { jobs = await env.STATE.list({ prefix: "tmin:" }); }
  catch (e) { console.error("text minutes list error", e && e.message); return; }
  if (!jobs || !jobs.keys || !jobs.keys.length) return;
  const key = jobs.keys[0].name;
  const chatId = key.slice(5); // "tmin:" 제거
  const merged = await env.STATE.get(key);
  await env.STATE.delete(key);
  if (!merged) return;
  try {
    const minutes = await createMeetingMinutes(env, merged);
    let body = (minutes && (minutes.full || minutes.short)) || "회의록 생성에 실패했습니다. 다시 시도해주세요.";
    if (/미상|미정/.test(body)) body += "\n\n날짜·참석 명단·주요 아젠다를 알려주시면 반영해 다시 작성해 드립니다.";
    await sendMessage(env, chatId, body);
  } catch (e) {
    console.error("runTextMinutesQueue error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "회의록 작성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}

async function saveMeetingInsight(env, row) {
  await env.DB.prepare(
    "INSERT INTO insights (chat_id, source_type, source_ref, schedule, category, project, summary, people, sender, input_chars, read_chars) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    String(row.chatId),
    "voice",
    row.sourceRef || "",
    "",
    "",
    "",
    String(row.summary || "").replace(/<\/?[a-zA-Z]+>/g, "").slice(0, 500),
    "",
    row.sender || "",
    row.inputChars || 0,
    Math.min(row.inputChars || 0, 16000)
  ).run();
}

// 저장된 최근 meeting 자료 조회.
async function latestMeeting(env, chatId) {
  try {
    return await env.DB.prepare(
      "SELECT id, file_id, filename, text, full_minutes, " +
      "(SELECT summary FROM insights i WHERE i.source_type = 'voice' AND i.source_ref = files.file_id ORDER BY id DESC LIMIT 1) AS summary " +
      "FROM files WHERE chat_id = ? AND text != '' AND text NOT LIKE '[받아쓰기 실패%' " +
      "AND (doc_type = 'meeting' OR filename LIKE '%.m4a' OR filename LIKE '%.ogg' OR filename LIKE '%.oga' " +
      "OR filename LIKE '%.mp3' OR filename LIKE '%.wav' OR filename LIKE '%voice%' OR filename LIKE '%녹음%' " +
      "OR filename LIKE '%.txt' OR filename LIKE '%.docx' OR filename LIKE '%.doc' OR filename LIKE '%.pdf') " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(String(chatId)).first();
  } catch (e) { console.error("minutes query error", e && e.message); return null; }
}

// 회의록 요청 접수 — 생성은 여기서 하지 않는다. 전사 존재만 확인하고 작업을 큐(KV)에 넣은 뒤
// 즉시 안내한다. 실제 회의록 생성(LLM)은 매분 Cron(generateMinutes)이 처리한다.
// (긴 전사의 회의록 생성도 웹훅 백그라운드 한도를 넘겨 멈추므로 Cron으로 분리.)
export async function makeMinutesFromStored(env, chatId) {
  const row = await latestMeeting(env, chatId);
  if (!row || !row.text) {
    return sendMessage(env, chatId, "최근 받아쓰기를 찾지 못했습니다. 녹음을 먼저 보내주세요.");
  }
  if (row.full_minutes) return sendMessage(env, chatId, await withMetaFollowup(env, chatId, row.file_id, row.full_minutes));
  // 상세본이 없으면 생성 작업을 큐에 넣는다. 다음 분 Cron(runVoiceQueue→generateMinutes)이 처리.
  await env.STATE.put("mj:" + chatId, "1", { expirationTtl: 1800 });
  return sendMessage(env, chatId,
    "상세 회의록을 생성 중입니다. 1~2분 후 /minutes 를 다시 보내주세요."
  );
}

// Cron 이 호출 — 저장된 전사로 회의록을 생성해 전송.
export async function generateMinutes(env, chatId) {
  const row = await latestMeeting(env, chatId);
  if (!row || !row.text) {
    return sendMessage(env, chatId, "최근 받아쓰기를 찾지 못했습니다. 녹음을 먼저 보내주세요.");
  }
  try {
    if (row.full_minutes) return sendMessage(env, chatId, await withMetaFollowup(env, chatId, row.file_id, row.full_minutes));
    const minutes = await createMeetingMinutes(env, row.text);
    await env.DB.prepare("UPDATE files SET doc_type = 'meeting', full_minutes = ? WHERE id = ?")
      .bind(minutes.full || null, row.id).run();
    const out = await withMetaFollowup(env, chatId, row.file_id, minutes.full || minutes.short);
    await sendMessage(env, chatId, out);
  } catch (e) {
    console.error("generateMinutes error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "회의록 작성에 실패했습니다. 잠시 후 다시 '회의록'이라고 보내주세요.");
  }
}

export async function regenerateMinutesWithMeta(env, chatId, fileId, metaText) {
  const row = await env.DB.prepare(
    "SELECT id, file_id, text FROM files WHERE file_id = ? AND text != '' ORDER BY id DESC LIMIT 1"
  ).bind(String(fileId || "")).first();
  if (!row || !row.text) {
    return sendMessage(env, chatId, "보강할 회의록 원문을 찾지 못했습니다. 문서를 다시 보내주세요.");
  }
  try {
    const minutes = await createMeetingMinutes(
      env,
      "추가 메타정보: " + String(metaText || "").trim() + "\n\n전사:\n" + row.text
    );
    const out = minutes.full || minutes.short;
    await env.DB.prepare("UPDATE files SET doc_type = 'meeting', full_minutes = ? WHERE id = ?")
      .bind(out || null, row.id).run();
    await sendMessage(env, chatId, out || "회의록을 다시 작성하지 못했습니다.");
  } catch (e) {
    console.error("regenerateMinutesWithMeta error", e && (e.stack || e.message));
    await sendMessage(env, chatId, "회의록 재작성에 실패했습니다. 잠시 후 다시 보내주세요.");
  }
}
