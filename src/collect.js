// collect.js — silently collect messages/files. entry for briefing/search/extract.
import { saveMessage, saveFile } from "./db.js";
import { senderName } from "./telegram.js";
import { maybeExtractEngagement } from "./extract.js";
import { extractInsight } from "./insight.js";

const INSIGHT_SIGNAL = /보고|일정|회의|미팅|면담|결정|승인|검토|발표|배포|규제|정책|국회|정부|공정위|산업부|BH|대통령|글로벌|언론|기사|PR|프로젝트|추진|협력|제휴|오찬/;

export async function collectMessage(env, msg) {
  const text = (msg.text || msg.caption || "").trim();
  const sender = senderName(msg);

  // file metadata (search source). file_id now, R2 later.
  if (msg.document) {
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: msg.document.file_id,
      filename: msg.document.file_name || "",
      text: "",
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
    await maybeExtractEngagement(env, msg, text);
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
