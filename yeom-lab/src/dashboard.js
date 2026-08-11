// dashboard.js — 목업③: Mini App 상황판. GET /dashboard 가 단일 HTML 을 반환한다.
// 외부 리소스 없이(인라인 CSS만) 동작. 카운트·목록은 실데이터.

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function pad(n) { return String(n).padStart(2, "0"); }
function kstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

export async function dashboardResponse(env) {
  let openAi = 0, todaySched = 0, subs = 0, aiList = [], projects = [], schedList = [];
  const today = kstToday();
  try { openAi = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM action_items WHERE status='open'").first()) || {}).n || 0; } catch (e) {}
  try { todaySched = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM schedules WHERE start_at LIKE ?").bind(today + "%").first()) || {}).n || 0; } catch (e) {}
  try { subs = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions").first()) || {}).n || 0; } catch (e) {}
  try {
    aiList = ((await env.DB.prepare(
      "SELECT content, created_at FROM action_items WHERE status='open' ORDER BY id DESC LIMIT 5"
    ).all()).results) || [];
  } catch (e) {}
  try {
    schedList = ((await env.DB.prepare(
      "SELECT title, start_at FROM schedules WHERE start_at >= ? ORDER BY start_at LIMIT 5"
    ).bind(today).all()).results) || [];
  } catch (e) {}
  try {
    // 프로젝트 신호등: 최근 7일 내 활동이 있으면 '주의(진행중 이슈)', 없으면 '정상'. (단순 규칙 — 다음 단계에서 정교화)
    projects = ((await env.DB.prepare(
      "SELECT project, MAX(created_at) AS last, COUNT(*) AS n FROM insights WHERE project != '' AND project IS NOT NULL " +
      "GROUP BY project ORDER BY last DESC LIMIT 10"
    ).all()).results) || [];
  } catch (e) {}

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const projRows = projects.map(function (p) {
    const active = String(p.last || "").slice(0, 10) >= weekAgo;
    const dot = active ? "🟡" : "🟢";
    const label = active ? "주의 · 최근 활동" : "정상";
    return '<div class="row"><span class="dot">' + dot + "</span><b>" + esc(p.project) + "</b>" +
      '<span class="meta">' + label + " · 자료 " + p.n + "건</span></div>";
  }).join("") || '<div class="empty">프로젝트 데이터 없음</div>';

  const aiRows = aiList.map(function (a) {
    return '<div class="row"><span class="dot">☐</span>' + esc(a.content) +
      '<span class="meta">' + esc(String(a.created_at || "").slice(0, 10)) + "</span></div>";
  }).join("") || '<div class="empty">미완료 항목 없음</div>';

  const schedRows = schedList.map(function (s) {
    const d = String(s.start_at || "");
    return '<div class="row"><span class="dot">🕐</span><b>' + esc(d.slice(5, 10)) + " " + esc(d.slice(11, 16)) +
      "</b> " + esc(s.title) + "</div>";
  }).join("") || '<div class="empty">예정된 일정 없음</div>';

  const html = "<!doctype html><html><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>염성진 에이전트 상황판</title><style>" +
    "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f4f6f9;color:#1c2733;padding:14px;max-width:560px;margin:0 auto}" +
    "h1{font-size:17px;margin:2px 0 12px}" +
    ".cards{display:flex;gap:8px;margin-bottom:14px}" +
    ".card{flex:1;background:#fff;border-radius:12px;padding:12px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}" +
    ".card .num{font-size:24px;font-weight:700}" +
    ".card .lbl{font-size:11px;color:#6b7a89;margin-top:2px}" +
    ".c1 .num{color:#d9534f}.c2 .num{color:#2b7de9}.c3 .num{color:#8a63d2}" +
    "h2{font-size:13px;color:#4a5866;margin:16px 0 6px}" +
    ".panel{background:#fff;border-radius:12px;padding:4px 12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}" +
    ".row{display:flex;align-items:baseline;gap:8px;padding:9px 0;border-bottom:1px solid #eef1f5;font-size:13px;line-height:1.45;flex-wrap:wrap}" +
    ".row:last-child{border-bottom:none}" +
    ".dot{flex:none}.meta{margin-left:auto;font-size:11px;color:#93a1af;flex:none}" +
    ".empty{padding:14px 0;color:#93a1af;font-size:12px;text-align:center}" +
    ".foot{margin:16px 0 6px;text-align:center;color:#aab5bf;font-size:11px}" +
    "</style></head><body>" +
    "<h1>📊 상황판</h1>" +
    '<div class="cards">' +
    '<div class="card c1"><div class="num">' + openAi + '</div><div class="lbl">확인필요</div></div>' +
    '<div class="card c2"><div class="num">' + todaySched + '</div><div class="lbl">금일 일정</div></div>' +
    '<div class="card c3"><div class="num">' + subs + '</div><div class="lbl">추적 이슈</div></div>' +
    "</div>" +
    "<h2>프로젝트 현황</h2><div class='panel'>" + projRows + "</div>" +
    "<h2>확인 필요사항 (미완료 Action Item)</h2><div class='panel'>" + aiRows + "</div>" +
    "<h2>다가오는 일정</h2><div class='panel'>" + schedRows + "</div>" +
    "<div class='foot'>yeom-lab · " + esc(today) + " 기준</div>" +
    "</body></html>";

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
