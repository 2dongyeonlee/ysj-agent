// claude.js — Anthropic Messages API 래퍼.

export const MODEL_FAST = "claude-haiku-4-5-20251001"; // 분류·단순작업
export const MODEL_SMART = "claude-sonnet-4-6";        // 요약·브리핑

export async function callClaude(env, userText, system = "", model = MODEL_FAST, maxTokens = 800) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Claude API error", JSON.stringify(data));
    return "응답 생성 중 오류가 발생했습니다.";
  }
  return textFromClaude(data) || "응답을 생성하지 못했습니다.";
}

function textFromClaude(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
