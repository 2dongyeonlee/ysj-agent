// collect.js — silently collect messages/files. entry for briefing/search/extract.
import { saveMessage, saveFile } from "./db.js";
import { senderName } from "./telegram.js";
import { maybeExtractEngagement } from "./extract.js";
import { extractInsight, captionProject, loadProjectKeywords } from "./insight.js";
import { extractText } from "./docparse.js";

const INSIGHT_SIGNAL = /보고|일정|회의|미팅|면담|결정|승인|검토|발표|배포|규제|정책|국회|정부|공정위|산업부|BH|대통령|글로벌|언론|기사|PR|프로젝트|추진|협력|제휴|오찬/;

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

function buildR2Key(meta) {
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

export async function collectMessage(env, msg) {
  const text = (msg.text || msg.caption || "").trim();
  const sender = senderName(msg);

  // file: R2 upload + text extract + insight + sender
  if (msg.document || (msg.photo && msg.photo.length)) {
    const isPhoto = !msg.document && !!(msg.photo && msg.photo.length);
    const fileId = msg.document
      ? msg.document.file_id
      : msg.photo[msg.photo.length - 1].file_id;
    const filename = (msg.document && msg.document.file_name) || "image.jpg";

    // 1) 텍스트 추출 (PDF/이미지 → Claude Vision/PDF 파서) — 전체 보존
    let extracted = "";
    try {
      extracted = await extractText(env, msg);
    } catch (e) {
      console.error("extractText isolated error", e && e.message);
    }

    // 2) insight 추출 (분류/프로젝트/일정/요약) — R2 키 분류 근거
    let meta = { category: "", project: "", filename, sender, isPhoto };
    try {
      if (extracted && extracted.length >= 10) {
        const ins = await extractInsight(env, {
          chatId: msg.chat.id,
          sourceType: "file",
          sourceRef: fileId,
          text: extracted,
          sender,
          caption: msg.caption || "",
          filename,
          receivedAt: msg.date ? new Date(msg.date * 1000) : new Date(),
        });
        if (ins && typeof ins === "object") {
          meta.category = ins.category || "";
          meta.project = ins.project || "";
        }
      }
    } catch (e) {
      console.error("file extractInsight isolated error", e && e.message);
    }

    // 캡션 #해시태그는 분류 최우선 — 텍스트추출 실패·사진이어도 지정 폴더로 보장.
    try {
      const kws = await loadProjectKeywords(env);
      const tagProj = captionProject(kws, msg.caption || "");
      if (tagProj) { meta.project = tagProj; meta.category = ""; }
    } catch (e) {
      console.error("captionProject isolated error", e && e.message);
    }

    // 사진·무제 파일은 추출 텍스트에서 제목 뽑아 키에 사용
    if (isPhoto || !msg.document) meta.titleGuess = titleFromText(extracted);

    // 3) R2 업로드
    let r2Key = "";
    try {
      const url = await getFileUrlPublic(env, fileId);
      if (url) {
        const fileRes = await fetch(url);
        if (fileRes.ok) {
          const data = await fileRes.arrayBuffer();
          r2Key = buildR2Key(meta);
          await env.R2.put(r2Key, data, {
            customMetadata: {
              category: meta.category || "",
              project: meta.project || "",
              sender: sender || "",
              filename,
            },
          });
        }
      }
    } catch (e) {
      console.error("R2 upload isolated error", e && e.message);
    }

    // 4) D1 files 저장 — r2_key + 추출 전체 텍스트(파싱 보존) + sender
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: fileId,
      r2_key: r2Key,
      filename,
      text: extracted || "",   // ← 요약이 아니라 전체 추출본 저장 (검색·재활용)
      sender,
    });
  }

  if (text) {
    await saveMessage(env, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      sender,
      text: text,
    });
    // auto-extract "who was met" into engagements (cheap keyword filter inside)
    try {
      await maybeExtractEngagement(env, msg, text);
    } catch (e) {
      console.error("maybeExtractEngagement isolated error", e && e.message);
    }
    if (text.length >= 20 && INSIGHT_SIGNAL.test(text)) {
      await extractInsight(env, {
        chatId: msg.chat.id,
        sourceType: "message",
        sourceRef: String(msg.message_id),
        text,
        sender,
        caption: msg.caption || "",
        filename: (msg.document && msg.document.file_name) || "",
        receivedAt: msg.date ? new Date(msg.date * 1000) : new Date(),
      });
    }
  }
}
