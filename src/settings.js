// settings.js — /설정 명령. 김선영(비서)이 코드 없이 봇 동작을 조정(L1).
// 형식: "/설정 <키> <값>"   예) "/설정 시간 08:00" · "/설정 말투 격식있게"
// 키가 없으면 "/설정 <자유지시>" → custom_prompt 로 저장.
// 설정값은 KV(STATE)에 저장되고, briefing/qa 가 읽어 반영한다.

const KEYS = {
  "시간": "briefing_time",     // 아침브리핑 시간 HH:MM (안전하게 조정 가능)
  "대상": "briefing_target",   // 브리핑 받을 방 ID
  "말투": "tone",              // 브리핑·답변 말투
};

export async function handleSettings(env, instruction) {
  const parts = instruction.split(/\s+/);
  const first = parts[0];
  const value = parts.slice(1).join(" ");

  if (KEYS[first] && value) {
    await env.STATE.put(KEYS[first], value);
    return `'${first}' → '${value}' 로 설정했습니다.`;
  }
  // 자유 지시 (규칙·말투 등을 프롬프트에 덧붙임)
  if (instruction) {
    await env.STATE.put("custom_prompt", instruction);
    return "반영했습니다.";
  }
  return "사용법: /설정 시간 08:00  ·  /설정 말투 격식있게  ·  /설정 <자유지시>";
}

export async function getSetting(env, key, fallback = "") {
  return (await env.STATE.get(key)) || fallback;
}

export async function getCustomPrompt(env) {
  return (await env.STATE.get("custom_prompt")) || "";
}
