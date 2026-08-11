// collect.js — silently collect messages/files. entry for briefing/search/extract.
import { saveMessage, saveFile, priorIdenticalMessage, qPush, qShift } from "./db.js";
import { senderName, senderId } from "./telegram.js";
import { sinceDaysIso } from "./utils.js";
import { maybeExtractEngagement } from "./extract.js";
import { extractInsight, captionProject, loadProjectKeywords } from "./insight.js";
import { extractText } from "./docparse.js";

const INSIGHT_CONTENT_RE = /보고|일정|회의|미팅|면담|간담회|결정|승인|검토|발표|배포|규제|정책|국회|정부|공정위|산업부|BH|대통령|글로벌|언론|기사|PR|프로젝트|추진|협력|제휴|오찬|자료|요약|공유|요청|의견|청취|리스크|대응|계획|변경|확인|준비|토킹포인트|O\/I|TF|Nexus|넥서스|서남권|용인|Pull-in/i;
const CHATTER_RE = /^(안녕하세요|감사합니다|네|넵|오 |아 |음|제가 |저장을|따로|보내주신|일정도|최근|여기까지|잘 |좋|맞아요|이해를|가능|\/|@)/;
const BOT_OUTPUT_RE = /^(📊|🗞|📂|📋|🪪|📄|요약할 내용|권한이 없습니다|현재 제공|안녕하세요\. 무엇을)/;

function shouldExtractInsight(text) {
  const body = String(text || "").trim();
  if (body.length < 20) return false;
  if (CHATTER_RE.test(body)) return false;
  if (BOT_OUTPUT_RE.test(body)) return false;
  if (/^\/[A-Za-z가-힣]/.test(body)) return false;
  if (/^@Yeom_agent_bot\b/.test(body)) return false;
  return INSIGHT_CONTENT_RE.test(body) || body.length >= 180;
}

// 텔레그램 file_id → 다운로드 URL (R2 업로드용). docparse 의 내부 헬퍼와 동일.
async function getFileUrlPublic(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) return "";
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

// 추출 텍스트에서 제목 후보 (사진·무제 파일용)
function titleFromText(extracted) {
  const t = String(extracted || "").trim();
  if (!t) return "";
  const m = t.match(/제목\s*[:：]\s*(.+)/);
  const cand = (m ? m[1] : t.split(/\n/)[0]).trim();
  return cand.slice(0, 20).replace(/[^\w.\-가-힣 ]/g, "").trim();
}

// R2 저장 키: {대분류}/{중분류}/{날짜}_{제목}_{공유자}{확장자}
// 입력 시점 분류로 고정. 분류가 바뀌어도 R2 키는 그대로, D1 메타만 갱신.
// 분류 → R2 상위 폴더(대분류/중분류). buildR2Key 와 재분류(reclass)가 공유.
export function r2Folder(meta) {
  if (meta && meta.project) return "project/" + meta.project;
  if (meta && meta.category) return "info/" + meta.category;
  return "etc/misc";
}

export function buildR2Key(meta) {
  const date = new Date().toISOString().slice(0, 10);
  const folder = r2Folder(meta);

  let title = "";
  if (meta.filename && !/^image\.jpg$/.test(meta.filename)) {
    title = meta.filename.replace(/\.[^.]+$/, "");
  } else if (meta.titleGuess) {
    title = meta.titleGuess;
  }
  title = (title || "무제").replace(/[^\w.\-가-힣 ]/g, "_").trim().replace(/\s+/g, "_");

  const who = (meta.sender || "").replace(/[^\w가-힣]/g, "").slice(0, 10) || "미상";
  const ext = meta.isPhoto ? ".jpg"
    : (meta.filename && meta.filename.match(/\.[^.]+$/) ? meta.filename.match(/\.[^.]+$/)[0] : "");
  return `${folder}/${date}_${title}_${who}${ext}`;
}

// 수동 공유자 지정 태그 파싱: 맨 앞 '공유: 이름' / '공유자: 이름' / '전달: 이름' 줄을 떼어 {sharer, rest} 반환.
function extractSharer(text) {
  const m = String(text || "").match(/^\s*(?:공유자?|전달자?)\s*[:：]\s*([^\n]{1,20})(?:\n|$)/);
  if (!m) return { sharer: "", rest: String(text || "") };
  return { sharer: m[1].trim(), rest: String(text || "").slice(m[0].length) };
}

// 다항목 브리핑 분리: 줄머리가 [제목] 인 섹션이 2개 이상이면 섹션별 배열로 쪼갠다. 아니면 null.
// 각 섹션에 브리핑 상단 날짜(m/d)를 prefix 해 일자 정렬이 되게 한다.
export function splitBriefingSections(text) {
  const body = String(text || "");
  const patterns = [
    /^[ \t]*\[[^\]\n]{1,40}\]/gm,
    /^[ \t]*(?:\d{1,2}[.)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•]\s*\[[^\]\n]{1,50}\])\s*/gm,
  ];
  const idxs = [];
  for (const re of patterns) {
    idxs.length = 0;
    let m;
    while ((m = re.exec(body)) !== null) idxs.push(m.index);
    if (idxs.length >= 2) break;
  }
  if (idxs.length < 2) return null;
  const dateHint = (body.slice(0, idxs[0]).match(/\d{1,2}\/\d{1,2}/) || body.match(/\d{1,2}\/\d{1,2}/) || [""])[0];
  const out = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i];
    const end = i + 1 < idxs.length ? idxs[i + 1] : body.length;
    let chunk = body.slice(start, end).trim();
    if (chunk.length < 20) continue;
    if (dateHint && !/\d{1,2}\/\d{1,2}/.test(chunk.slice(0, 40))) chunk = dateHint + " " + chunk;
    out.push(chunk);
  }
  return out.length >= 2 ? out : null;
}

export async function collectMessage(env, msg) {
  const text = (msg.text || msg.caption || "").trim();
  const sender = senderName(msg);

  // 오디오 문서(.m4a 등)는 voice.js(handleVoice)가 전사·분류·백업까지 전담 → 여기선 제외(중복 방지).
  const isAudioDoc = msg.document && (
    /audio/i.test(msg.document.mime_type || "") ||
    /\.(ogg|oga|mp3|m4a|wav|aac|opus|flac|amr)$/i.test(msg.document.file_name || "")
  );

  // file: 빠른 접수만 — R2 업로드 + files 행 생성. 무거운 파싱/LLM은 Cron(runFileProcessQueue)로.
  if (!isAudioDoc && (msg.document || (msg.photo && msg.photo.length))) {
    const isPhoto = !msg.document && !!(msg.photo && msg.photo.length);
    const fileId = msg.document ? msg.document.file_id : msg.photo[msg.photo.length - 1].file_id;
    const filename = (msg.document && msg.document.file_name) || "image.jpg";

    // R2 업로드 (원본 보존) — 텍스트 추출/insight 없이 빠르게.
    let r2Key = "";
    try {
      const url = await getFileUrlPublic(env, fileId);
      if (url) {
        const fileRes = await fetch(url);
        if (fileRes.ok) {
          const data = await fileRes.arrayBuffer();
          r2Key = buildR2Key({ category: "", project: "", filename, sender, isPhoto });
          await env.R2.put(r2Key, data, { customMetadata: { category: "", project: "", sender: sender || "", filename } });
        }
      }
    } catch (e) { console.error("R2 upload isolated error", e && e.message); }

    // files 행 생성: text 비움(='') + process_status='pending'. Cron이 채운다.
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: fileId,
      r2_key: r2Key,
      filename,
      text: "",
      sender,
    });
    try {
      await env.DB.prepare("UPDATE files SET process_status='pending' WHERE file_id=? AND chat_id=?")
        .bind(fileId, String(msg.chat.id)).run();
    } catch (e) { console.error("file pending mark error", e && e.message); }
    // 무거운 처리 큐에 적재 (chatId, fileId, isPhoto, caption)
    try {
      await qPush(env, "fp", { chatId: String(msg.chat.id), fileId: fileId, isPhoto: isPhoto, caption: msg.caption || "", filename: filename, sender: sender });
    } catch (e) { console.error("fp queue push error", e && e.message); }
  }

  if (text) {
    // 수동 공유자 지정: 맨 앞 줄 '공유: 이름' / '공유자: 이름' / '전달: 이름' → 그 사람을 공유자로.
    const { sharer, rest } = extractSharer(text);
    const effSender = sharer || sender;
    const bodyText = (rest && rest.trim().length >= 1) ? rest : text;

    await saveMessage(env, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      sender: effSender,
      text: bodyText,
    });
    // auto-extract "who was met" into engagements (cheap keyword filter inside)
    try {
      await maybeExtractEngagement(env, msg, bodyText);
    } catch (e) {
      console.error("maybeExtractEngagement isolated error", e && e.message);
    }
    // 내용기반 중복제거: 동일 본문이 최근 30일 내 이미 저장·분류됐으면 재추출 생략.
    // → forward/붙여넣기로 같은 자료를 여러 번 넣어도 /info 에 한 번만(LLM 호출도 절약).
    //   (가장 먼저 들어온 1건이 유지된다. 발신자 정정이 필요하면 본문을 바꾸거나 '공유: 이름' 사용)
    let dupBody = false;
    try {
      dupBody = await priorIdenticalMessage(env, msg.chat.id, bodyText, msg.message_id, sinceDaysIso(30));
    } catch (e) {
      console.error("dedup check isolated error", e && e.message);
    }

    if (!dupBody && shouldExtractInsight(bodyText)) {
      const baseIns = {
        chatId: msg.chat.id,
        sourceType: "message",
        sender: effSender,
        senderId: senderId(msg),
        caption: msg.caption || "",
        filename: (msg.document && msg.document.file_name) || "",
        receivedAt: msg.date ? new Date(msg.date * 1000) : new Date(),
      };
      // 다항목 브리핑([제목] 섹션 2개 이상)은 섹션별로 분리 저장 → /info 에 각각 노출.
      const sections = splitBriefingSections(bodyText);
      if (sections) {
        for (let i = 0; i < sections.length; i++) {
          await extractInsight(env, Object.assign({}, baseIns, {
            sourceRef: String(msg.message_id) + "#" + (i + 1),
            text: sections[i],
          }));
        }
      } else {
        await extractInsight(env, Object.assign({}, baseIns, {
          sourceRef: String(msg.message_id),
          text: bodyText,
        }));
      }
    }
  }
}

// Cron 호출 — 대기 중인 파일 1건의 텍스트 추출 + insight + 분류 갱신.
export async function runFileProcessQueue(env) {
  let job;
  try { job = await qShift(env, "fp"); } catch (e) { console.error("fp shift error", e && e.message); return; }
  if (!job || !job.fileId) return;
  const { chatId, fileId, isPhoto, caption, filename, sender } = job;

  // 원본 메시지 객체가 없으므로, extractText가 file_id 기반으로 동작하도록 최소 msg 구성.
  let extracted = "";
  try {
    const pseudoMsg = isPhoto
      ? { photo: [{ file_id: fileId }], caption }
      : { document: { file_id: fileId, file_name: filename }, caption };
    extracted = await extractText(env, pseudoMsg);
  } catch (e) { console.error("fp extractText error", fileId, e && e.message); }

  let category = "", project = "";
  try {
    if (extracted && extracted.length >= 10) {
      const ins = await extractInsight(env, {
        chatId, sourceType: "file", sourceRef: fileId, text: extracted,
        sender: sender || "", caption: caption || "", filename: filename || "",
        receivedAt: new Date(),
      });
      if (ins && typeof ins === "object") { category = ins.category || ""; project = ins.project || ""; }
    }
  } catch (e) { console.error("fp extractInsight error", fileId, e && e.message); }

  try {
    const kws = await loadProjectKeywords(env);
    const tagProj = captionProject(kws, caption || "");
    if (tagProj) { project = tagProj; category = ""; }
  } catch (e) { console.error("fp captionProject error", e && e.message); }

  try {
    await env.DB.prepare("UPDATE files SET text=?, process_status='done' WHERE file_id=? AND chat_id=?")
      .bind((extracted || "").slice(0, 16000), fileId, String(chatId)).run();
  } catch (e) { console.error("fp save error", fileId, e && e.message); }
}
