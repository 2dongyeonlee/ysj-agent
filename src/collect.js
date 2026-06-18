// collect.js — 방·DM의 메시지·자료를 무음 수집. 브리핑·검색·접촉축적의 입구.

import { saveMessage, saveFile } from "./db.js";
import { senderName } from "./telegram.js";
import { maybeExtractEngagement } from "./extract.js";

export async function collectMessage(env, msg) {
  const text = (msg.text || msg.caption || "").trim();

  // 1) 파일/자료 메타 저장 (기능2 원천). 지금은 file_id, 나중에 R2.
  if (msg.document) {
    await saveFile(env, {
      chat_id: msg.chat.id,
      file_id: msg.document.file_id,
      filename: msg.document.file_name || "",
      text: "", // 추출 텍스트는 P4 에서 extractDocumentText 로 채움
    });
  }

  // 2) 텍스트 메시지 저장 (기능1·2 원천)
  if (text) {
    await saveMessage(env, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      sender: senderName(msg),
      text,
    });

    // 3) "누구 만남" 자동 추출 → engagements (기능3·4 원천). 지금은 stub.
    await maybeExtractEngagement(env, msg, text);
  }
}
