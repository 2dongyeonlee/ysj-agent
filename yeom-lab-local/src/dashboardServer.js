// dashboardServer.js — Mini App 상황판을 로컬 HTTP 서버로 서빙.
// dashboard.js 는 손대지 않고 그대로 재사용(웹표준 Response 객체 반환 — Node 18+ 내장 fetch API).

import http from "node:http";
import { dashboardResponse } from "./dashboard.js";

export function startDashboardServer(env, port) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/dashboard" || req.url.startsWith("/dashboard?")) {
      try {
        const webRes = await dashboardResponse(env);
        res.writeHead(webRes.status || 200, Object.fromEntries(webRes.headers));
        res.end(await webRes.text());
      } catch (e) {
        console.error("dashboard error", e && e.stack);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("상황판 생성 중 오류가 발생했습니다.");
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("yeom-lab-local ok — 상황판은 /dashboard 로 접속하세요.");
  });
  server.listen(port, () => {
    console.log(`[dashboard] http://localhost:${port}/dashboard`);
  });
  return server;
}
