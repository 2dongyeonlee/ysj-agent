// claude.js — 텍스트 생성 래퍼. 다른 모든 파일은 이 함수 하나만 호출하므로,
// 분류·요약·브리핑·회의록 프롬프트/로직은 전혀 바뀌지 않았다 — 실제 호출 대상만
// Anthropic Claude API에서 로컬 Ollama(무료 오픈소스 LLM, PC에서 직접 실행)로 바꿨다.

export const MODEL_FAST = "qwen2.5:7b"; // 분류·단순작업
export const MODEL_SMART = "qwen2.5:7b"; // 요약·브리핑

export async function callClaude(env, userText, system = "", model = MODEL_FAST, maxTokens = 800) {
  const baseUrl = env.OLLAMA_BASE_URL || "http://localhost:11434";
  const useModel = env.OLLAMA_MODEL || model;
  const messages = system
    ? [{ role: "system", content: system }, { role: "user", content: userText }]
    : [{ role: "user", content: userText }];

  let res;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        messages,
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
  } catch (e) {
    console.error("Ollama 연결 실패:", e && e.message);
    return "로컬 LLM(Ollama)에 연결할 수 없습니다. Ollama가 실행 중인지 확인해주세요 (ollama serve).";
  }

  const data = await res.json();
  if (!res.ok) {
    console.error("Ollama API error", JSON.stringify(data));
    return "응답 생성 중 오류가 발생했습니다.";
  }
  return (data && data.message && data.message.content && data.message.content.trim()) || "응답을 생성하지 못했습니다.";
}
