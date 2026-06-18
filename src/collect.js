// collect.js — silently collect messages/files. entry for briefing/search/extract.
import { saveMessage, saveFile } from "./db.js";
import { senderName } from "./telegram.js";
import { maybeExtractEngagement } from "./extract.js";

export async function collectMessage(env, msg) {
  const text = (msg.text || msg.caption || "").trim();

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
      sender: senderName(msg),
      text: text,
    });
    // auto-extract "who was met" into engagements (cheap keyword filter inside)
    await maybeExtractEngagement(env, msg, text);
  }
}
