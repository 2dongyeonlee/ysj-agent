// qa.js — general Q&A. answers when the bot is addressed.

import { searchMessages } from "./db.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { sendMessage } from "./telegram.js";
import { PERSONA } from "./persona.js";

const QA_SYSTEM = PERSONA + "\n\n" +
  "[역할] 수집된 대화·자료를 바탕으로 간결하고 정확하게 답변하세요. " +
  "모르는 것은 모른다고 솔직히 말하고, 추측은 추측임을 밝히세요. 이모지 금지.";

function safeKeyword(q) {
  const cleaned = String(q || "")
    .replace(/[%_'"\\\n\r\t]/g, " ")
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(function (t) { return t.length >= 2; });
  if (!tokens.length) return "";
  tokens.sort(function (a, b) { return b.length - a.length; });
  return tokens[0].slice(0, 15);
}

export async function handleQA(env, chatId, question) {
  if (!question) return sendMessage(env, chatId, "질문 내용을 입력해 주세요.");
  let context = "";
  const kw = safeKeyword(question);
  if (kw) {
    try {
      const rows = await searchMessages(env, kw);
      if (rows && rows.length) {
        context = "\n\n[참고 대화]\n" + rows.slice(0, 6).map(function (r) {
          return r.sender + ": " + r.text;
        }).join("\n");
      }
    } catch (e) {
      console.error("searchMessages error", e && e.message);
    }
  }
  const answer = await callClaude(env, question + context, QA_SYSTEM, MODEL_SMART, 1000);
  await sendMessage(env, chatId, answer);
}
