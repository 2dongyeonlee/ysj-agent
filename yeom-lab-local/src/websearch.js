// websearch.js — Tavily 웹검색. 대외 뉴스·정보 조회. (KOH봇 searchWeb 대응)
// qa/briefing 에서 외부 정보가 필요할 때 호출. [stub]

export async function searchWeb(env, query, maxResults = 5) {
  // TODO:
  //  POST https://api.tavily.com/search
  //    body: { api_key: env.TAVILY_API_KEY, query, max_results: maxResults }
  //  → [{ title, url, content }] 형태로 반환
  return []; // 아직 미구현
}
