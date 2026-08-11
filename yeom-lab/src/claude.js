// claude.js — Anthropic Messages API 래퍼.

export const MODEL_FAST = "claude-haiku-4-5-20251001"; // 분류·단순작업
// 실험용(yeom-lab): 비용 최소화를 위해 요약·브리핑도 Haiku 사용 (최저가: $1/$5 per 1M tokens)
export const MODEL_SMART = "claude-haiku-4-5-20251001"; // 요약·브리핑

export async function callClaude(env, userText, system = "", model = MODEL_FAST, maxTokens = 800) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // 시스템 프롬프트를 캐시(반복 호출 시 입력 토큰 90% 할인). 짧으면 자동 미적용.
      system: system
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : undefined,
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
