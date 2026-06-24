// index.js — entry point. routing only. Bot stays silent unless explicitly called.
import { collectMessage } from "./collect.js";
import { runMorningBriefing, runBrief } from "./briefing.js";
import { enqueueDocumentSummary, runDocumentSummaryQueue, summarizeFile, summarizeLatest } from "./summarize.js";
import { handleQA } from "./qa.js";
import { runInfoBriefing } from "./info.js";
import { runProjectBriefing } from "./project.js";
import { handleVoice, makeMinutesFromStored, regenerateMinutesWithMeta, runVoiceQueue, summarizeRecentMessages, runTextMinutesQueue, summarizeMessageBlock } from "./voice.js";
import { classifyIntent } from "./intent.js";
import { sendMessage, sendDocument, sendDocumentBytes } from "./telegram.js";
import { callClaude, MODEL_SMART } from "./claude.js";
import { addProjectKeyword, listProjects, deleteProject, addSubtask, listSubtasks, delSubtasks, checkInsights, dedupInsights, getResummaryTargets, updateInsightSummary } from "./db.js";
import { resummarizeText } from "./insight.js";
import { splitBriefingSections } from "./collect.js";
import { runReclass } from "./reclass.js";
import { extractText } from "./docparse.js";

// 권한자 인식. (1) chat_id 기반: ADMIN_CHAT_ID 또는 BRIEFING_TARGET_ID 채팅 — @username
// 미설정 단말에서도 동작(권장). (2) ADMIN_USERNAMES @username 기반(보조).
const ALLOWED_ADMINS = ["CHANGE_ME"];
// 대시보드 변수 설정이 막힐 때를 위한 코드 내 관리자 chat_id (예: ["123456789"]).
// /whoami 로 확인한 본인 chat_id 를 넣으면 대시보드 없이 관리자 권한이 적용된다.
const ADMIN_CHAT_IDS = ["5965410906", "624410079"];

const CUSTOM_DOC_SYSTEM = "자료를 사용자 요청 형식대로 보고용 정리. 형식 미지정시 ■ 배경/주요내용/Action/일정/참석 양식. 이모지·마크다운 금지, <b>만. 없는내용 창작금지.";

function csv(value) {
  return String(value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function adminUsernames(env) {
  const fromEnv = csv((env && env.ADMIN_USERNAMES) || "").map(function (s) { return s.replace(/^@/, "").toLowerCase(); });
  const fromCode = ALLOWED_ADMINS.map(function (s) { return String(s).trim().replace(/^@/, "").toLowerCase(); }).filter(Boolean);
  return fromEnv.concat(fromCode);
}

async function customSummarizeDoc(env, chatId, docMsg, instruction) {
  const body = await extractText(env, docMsg);
  if (!body || String(body).trim().length < 20) {
    return sendMessage(env, chatId, "문서 본문을 읽지 못했습니다. 텍스트 선택 가능한 PDF, .docx, 또는 .txt로 다시 보내주세요.");
  }
  const prompt =
    "사용자 요청:\n" + String(instruction || "").trim() +
    "\n\n자료 본문:\n" + String(body || "").slice(0, 9000);
  const out = await callClaude(env, prompt, CUSTOM_DOC_SYSTEM, MODEL_SMART, 2000);
  return sendMessage(env, chatId, out || "문서 정리에 실패했습니다. 다시 시도해주세요.");
}

function adminChatIds(env) {
  return ADMIN_CHAT_IDS
    .concat(csv((env && env.ADMIN_CHAT_ID) || ""))
    .concat(csv((env && env.BRIEFING_TARGET_ID) || ""));
}

function isAdmin(env, msg) {
  const chatId = String((msg.chat && msg.chat.id) || "");
  if (chatId && adminChatIds(env).indexOf(chatId) !== -1) return true;
  const uname = String((msg.from && msg.from.username) || "").toLowerCase();
  return !!uname && adminUsernames(env).indexOf(uname) !== -1;
}

// '자료 적재' 메시지 판별: 전달(forward)·공유태그·보고문(장문/다항목)은 '질의'가 아니라
// 보관용 콘텐츠다. 조용히 수집만 하고 자동으로 브리핑/요약을 띄우지 않는다.
// (명시적 명령 /info 등이나 봇 멘션·자연어 질문일 때만 응답한다.)
function isDepositMessage(msg, text) {
  // 1) 전달된 메시지 — 남이 만든 콘텐츠를 그대로 옮겨 담는 것.
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat ||
      msg.forward_sender_name || msg.forward_date) return true;
  const t = String(text || "");
  // 2) 수동 공유 태그('공유:/공유자:/전달: 이름')로 시작.
  if (/^\s*(?:공유자?|전달자?)\s*[:：]/.test(t)) return true;
  // 3) 보고문 헤더(<Daily>, <주간> 등)로 시작.
  if (/^\s*<[^>\n]{1,20}>/.test(t)) return true;
  // 4) 다항목 브리핑([제목] 섹션 2개 이상).
  if ((t.match(/^[ \t]*\[[^\]\n]{1,40}\]/gm) || []).length >= 2) return true;
  // 5) 줄바꿈 있는 장문(질문이 아닌 보고문). 짧은 질의는 통과.
  if (t.length >= 200 && t.indexOf("\n") !== -1) return true;
  return false;
}

// 텔레그램 file_id → 다운로드 URL (R2 이관용). collect.js 의 동일 헬퍼.
async function getFileUrlPublic(env, fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await res.json();
  if (!data.ok) return "";
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

const HELP =
  "📋 <b>사용 안내</b>\n\n" +
  "자료는 자동 저장·분류되고, 녹음은 받아쓰기 후 '회의록'이라고 보내면 회의록을 작성합니다.\n" +
  "궁금한 건 그냥 말씀하시면 됩니다.\n\n" +
  "<b>명령어</b>\n" +
  "• /brief — 오늘 챙길 것 (결정·만남·보고 건)\n" +
  "• /info — 대외정보 (정부·BH·국회·언론·글로벌·경쟁사)\n" +
  "• /project [이름] — 프로젝트 진행 경과\n" +
  "• /summary [키워드] — 자료 요약\n" +
  "• /minutes (또는 '회의록') — 최근 녹음으로 회의록 작성\n\n" +
  "<b>자연어 질문 예시</b>\n" +
  "• \"넥서스 어떻게 됐어?\" — 프로젝트 현황\n" +
  "• \"오늘 만남 뭐 있어?\" — 브리핑\n" +
  "• \"김영훈 장관 면담 자료 공유해줘\" — 원본 전송\n\n" +
  "<i>프로젝트 관리: /addproject · /listproject · /delproject</i>\n" +
  "<i>기존 파일 재분류: /reclass</i>";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    let update;
    try { update = await request.json(); } catch { return new Response("ok"); }
    if (update.my_chat_member) return new Response("ok");
    const msg = update.message;
    if (!msg) return new Response("ok");
    // 무거운 처리(녹음 STT·요약 등)는 응답을 막지 않도록 백그라운드로 돌린다.
    // Telegram 에 즉시 200 을 돌려줘 웹훅 타임아웃(~60s)·재시도·중복 전송을 방지.
    ctx.waitUntil(
      route(env, msg).catch((e) => console.error("route error", (e && e.stack) || e))
    );
    return new Response("ok");
  },

  async scheduled(event, env, ctx) {
    // 매분 Cron — 대기 중인 녹음 받아쓰기(STT). 웹훅보다 실행시간이 길어 긴 녹음도 처리.
    if (event.cron === "* * * * *") {
      ctx.waitUntil((async function () {
        await runDocumentSummaryQueue(env);
        await runTextMinutesQueue(env);
        await runVoiceQueue(env);
      })().catch((e) => console.error("minute queue error", (e && e.stack) || e)));
      return;
    }
    // 평일 아침 브리핑.
    ctx.waitUntil((async function () {
      await runMorningBriefing(env);
      await runInfoBriefing(env, null, 7);
    })());
  },
};

async function route(env, msg) {
  const chatId = msg.chat.id;
  const botUsername = env.BOT_USERNAME || "";
  const rawText = (msg.text || msg.caption || "").trim();
  // 단체방 멘션 여부를 먼저 기억(자연어 게이트용), 그 뒤 @봇이름을 제거해 명령·자연어를 정규화
  const wasMentioned = !!(botUsername && rawText.indexOf("@" + botUsername) !== -1);
  const text = botUsername
    ? rawText.replace(new RegExp("@" + botUsername + "\\b\\s*", "ig"), "").trim()
    : rawText;
  const isMentioned = wasMentioned;
  const isDM = msg.chat.type === "private";

  const key = "msg:" + chatId + ":" + msg.message_id;
  if (await env.STATE.get(key)) return;
  await env.STATE.put(key, "1", { expirationTtl: 60 });

  const mctx = await env.STATE.get("mctx:" + chatId);
  if (mctx && text && !text.startsWith("/") && /\d|참석|안건|명단|날짜/.test(text)) {
    await env.STATE.delete("mctx:" + chatId);
    return regenerateMinutesWithMeta(env, chatId, mctx, text);
  }

  // ---- commands (ASCII only). arg = text after the command ----
  if (text === "/help" || text === "/start") return sendMessage(env, chatId, HELP);

  // 내 chat_id·관리자 여부 확인 (권한 설정용). 누구나 사용 가능.
  if (text === "/whoami") {
    const uname = (msg.from && msg.from.username) ? "@" + msg.from.username : "(없음)";
    const ok = isAdmin(env, msg);
    return sendMessage(env, chatId,
      "🪪 <b>내 정보</b>\n" +
      "• chat_id: <code>" + chatId + "</code>\n" +
      "• username: " + uname + "\n" +
      "• 관리자 인식: " + (ok ? "예 ✅" : "아니오 ❌") +
      (ok ? "" :
        "\n\n관리자로 쓰려면 Cloudflare 대시보드 → Workers → ysj-agent → Settings → Variables 에\n" +
        "<code>ADMIN_CHAT_ID = " + chatId + "</code>\n추가 후 저장하세요(재배포 불필요)."));
  }

  // 녹음 큐 진단(읽기 전용): 최근 오디오 행의 방(chat_id)·전사 상태·R2 여부를 그대로 보여준다.
  if (text === "/vq") {
    const { results } = await env.DB.prepare(
      "SELECT id, chat_id, filename, sender, r2_key, " +
      "CASE WHEN text IS NULL OR text = '' THEN '대기' WHEN text LIKE '[받아쓰기 실패%' THEN '실패' ELSE ('완료(' || length(text) || '자)') END AS st, " +
      "created_at FROM files " +
      "WHERE (filename LIKE '%.m4a' OR filename LIKE '%.ogg' OR filename LIKE '%.oga' OR filename LIKE '%.mp3' " +
      "OR filename LIKE '%.wav' OR filename LIKE '%.aac' OR filename LIKE '%.opus' OR filename LIKE '%.amr' " +
      "OR filename LIKE '%.flac' OR filename LIKE '%voice%' OR filename LIKE '%녹음%') " +
      "ORDER BY id DESC LIMIT 12"
    ).all();
    if (!results || !results.length) return sendMessage(env, chatId, "최근 오디오 행이 없습니다.");
    const lines = results.map(function (r) {
      return "#" + r.id + " · " + r.st + " · " + (r.r2_key ? "R2✓" : "R2✗") +
        "\n   방:" + r.chat_id + " · " + (r.filename || "") + " · " + (r.sender || "") +
        "\n   " + r.created_at;
    });
    const lock = await env.STATE.get("vq:lock");
    const mj = await env.STATE.list({ prefix: "mj:" });
    return sendMessage(env, chatId,
      "🩺 <b>녹음 큐 상태</b> (이 방 id: <code>" + chatId + "</code>)\n" +
      "락:" + (lock ? "처리중" : "없음") + " · 회의록대기:" + ((mj.keys || []).length) + "건\n\n" +
      lines.join("\n"));
  }

  // 기존 파일 일괄 이관 (권한자만): r2_key 빈 행을 R2 로 옮긴다.
  if (text === "/migrate") {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const { results } = await env.DB.prepare(
      "SELECT id, file_id, filename FROM files WHERE (r2_key = '' OR r2_key IS NULL) AND file_id != '' LIMIT 50"
    ).all();
    let done = 0, fail = 0;
    for (const row of (results || [])) {
      try {
        const url = await getFileUrlPublic(env, row.file_id);
        if (!url) { fail++; continue; }
        const fr = await fetch(url);
        if (!fr.ok) { fail++; continue; }
        const body = await fr.arrayBuffer();
        const key = "migrated/" + (row.filename || ("file_" + row.id)).replace(/[^\w.\-가-힣]/g, "_");
        await env.R2.put(key, body);
        await env.DB.prepare("UPDATE files SET r2_key = ? WHERE id = ?").bind(key, row.id).run();
        done++;
      } catch (e) {
        console.error("migrate row error", row.id, e && e.message);
        fail++;
      }
    }
    return sendMessage(env, chatId, "이관 완료: 성공 " + done + "건, 실패 " + fail + "건 (file_id 만료 시 실패)");
  }

  // 기존 적재 파일 재분류 (권한자만): 저장된 텍스트로 다시 분류해 R2 폴더 이동.
  if (text === "/reclass" || text.startsWith("/reclass ")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    return runReclass(env, chatId, text.indexOf("reset") !== -1);
  }

  // 저장 점검(진단용, 권한자만): 최근 저장 항목의 분류·발신자·경로를 그대로 보여준다.
  // 예) /check          → 최근 15건
  //     /check 중복상장 → '중복상장' 들어간 항목이 어디로(정부/프로젝트/내부) 분류됐는지·누구 이름으로 저장됐는지
  if (text === "/check" || text.startsWith("/check ")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const kw = text.replace("/check", "").trim();
    const rows = await checkInsights(env, kw, 20);
    if (!rows.length) return sendMessage(env, chatId, "저장된 항목이 없습니다" + (kw ? " ('" + kw + "')" : "") + ".");

    // 중복 표시: 같은 dupkey(원문+섹션 동일)가 2건 이상이면 중복. 그룹별로 가장 먼저 들어온 것이 '원본'.
    const groups = {};
    for (const r of rows) { (groups[r.dupkey] = groups[r.dupkey] || []).push(r); }
    let dupGroupCount = 0;
    for (const k in groups) if (groups[k].length > 1) dupGroupCount++;

    const header = "🔎 <b>저장 점검</b>" + (kw ? " · " + kw : "") + " — " + rows.length + "건" +
      (dupGroupCount ? " · ⚠️중복 " + dupGroupCount + "그룹" : "");
    const lines = [header, ""];
    for (const r of rows) {
      const cls = r.project ? ("📁프로젝트:" + r.project)
        : (r.category ? ("🏷대외정보:" + r.category) : "⬜분류없음(내부/미상)");
      const grp = groups[r.dupkey] || [r];
      let dupTag = "";
      if (grp.length > 1) {
        // id 오름차순으로 가장 작은(먼저 저장된) 것이 원본, 나머지는 중복.
        const minId = Math.min.apply(null, grp.map(function (x) { return x.id; }));
        dupTag = (r.id === minId) ? "  ⚠️중복 원본(" + grp.length + "건)" : "  ⚠️중복";
      }
      const when = String(r.created_at || "").slice(5, 16); // MM-DD HH:MM
      lines.push("• <b>" + when + "</b> · " + cls + dupTag);
      lines.push("   공유자: <b>" + (r.sender || "미상") + "</b> · 경로:" + (r.source_type || "?") + " · ref:" + (r.source_ref || "-"));
      lines.push("   " + String(r.summary || "").replace(/<\/?[a-zA-Z]+>/g, "").slice(0, 60));
      lines.push("");
    }
    if (dupGroupCount) lines.push("ℹ️ ⚠️중복 = 같은 내용이 여러 번 저장됨(원본 1건 + 중복). 정리가 필요하면 말씀하세요.");
    return sendMessage(env, chatId, lines.join("\n"));
  }

  // 중복 정리(권한자만): 같은 내용이 여러 번 저장된 것을 그룹당 1건(원본)만 남기고 삭제.
  //  /dedup        → 미리보기(삭제 안 함)
  //  /dedup 실행   → 실제 삭제
  if (text === "/dedup" || text.startsWith("/dedup ")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/dedup", "").trim();
    const execute = (arg === "실행" || arg === "확정" || arg === "go" || arg === "yes");
    let res;
    try {
      res = await dedupInsights(env, execute);
    } catch (e) {
      console.error("dedup error", (e && e.stack) || e);
      return sendMessage(env, chatId, "⚠️ 중복 정리 중 오류가 발생했습니다: " + ((e && e.message) || e));
    }
    if (!execute) {
      return sendMessage(env, chatId,
        "🧹 <b>중복 정리 미리보기</b>\n" +
        "• 전체 " + res.total + "건 · 중복 " + res.groupCount + "그룹\n" +
        "• 삭제 예정 <b>" + res.deleteCount + "건</b> (그룹마다 가장 먼저 저장된 1건은 보존)\n\n" +
        (res.deleteCount
          ? "실제로 지우려면 <code>/dedup 실행</code> 을 보내세요. (되돌릴 수 없습니다)"
          : "지울 중복이 없습니다."));
    }
    return sendMessage(env, chatId,
      "✅ <b>중복 정리 완료</b>\n" +
      "• 삭제 " + res.deleteCount + "건 · 보존 " + (res.total - res.deleteCount) + "건 (전체 " + res.total + " → " + (res.total - res.deleteCount) + ")");
  }

  // 기존 항목 재요약(권한자만): 원문을 다시 읽어 빈약한 요약을 구체적으로 교체. 분류는 그대로.
  //  /resummary        → 빈약한 요약만 재작성(원문 있는 것, 최대 20건)
  //  /resummary 전체   → 빈약 여부 무관 최근 20건 재작성
  if (text === "/resummary" || text.startsWith("/resummary ")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/resummary", "").trim();
    const all = (arg === "전체" || arg === "all");
    let targets;
    try {
      targets = await getResummaryTargets(env, 20, !all);
    } catch (e) {
      console.error("resummary targets error", (e && e.stack) || e);
      return sendMessage(env, chatId, "⚠️ 재요약 대상 조회 중 오류: " + ((e && e.message) || e));
    }
    if (!targets.length) return sendMessage(env, chatId, "재요약할 항목이 없습니다(원문이 남아있는 빈약한 요약이 없음). 전체 대상은 <code>/resummary 전체</code>.");
    await sendMessage(env, chatId, "🔧 재요약 시작 — 대상 " + targets.length + "건(원문 기준). 잠시 후 결과를 알려드립니다…");
    let ok = 0, fail = 0;
    for (const t of targets) {
      try {
        let raw = String(t.raw_message || t.raw_file || "");
        // 다항목 브리핑의 섹션(#N)이면 해당 섹션 텍스트만 재요약.
        const ref = String(t.source_ref || "");
        if (ref.indexOf("#") !== -1 && t.raw_message) {
          const n = parseInt(ref.split("#")[1], 10);
          const secs = splitBriefingSections(t.raw_message);
          if (secs && secs[n - 1]) raw = secs[n - 1];
        }
        const r = await resummarizeText(env, raw);
        if (r && r.summary && r.summary !== t.summary) {
          await updateInsightSummary(env, t.id, r.summary, r.people, r.schedule);
          ok++;
        }
      } catch (e) {
        console.error("resummary item error", t.id, e && e.message);
        fail++;
      }
    }
    return sendMessage(env, chatId,
      "✅ <b>재요약 완료</b>\n• 갱신 " + ok + "건" + (fail ? " · 실패 " + fail + "건" : "") +
      "\n남은 빈약 항목이 있으면 <code>/resummary</code> 를 다시 보내세요. (분류는 그대로, 요약만 개선)");
  }

  // 프로젝트 키워드 관리 (권한자만)
  if (text.startsWith("/addproject")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/addproject", "").trim();
    let project = "", kwPart = "";
    if (arg.indexOf("|") !== -1) {
      const parts = arg.split("|");
      project = parts[0].trim();
      kwPart = parts.slice(1).join("|").trim();
    } else {
      const sp = arg.indexOf(" ");
      if (sp !== -1) { project = arg.slice(0, sp).trim(); kwPart = arg.slice(sp + 1).trim(); }
    }
    const keywords = kwPart.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!project || !keywords.length) {
      return sendMessage(env, chatId, "형식: /addproject 프로젝트 | 키워드,키워드\n예: /addproject 용인 Pull-in | 용인,pull-in\n\n※ 파일 공유 시 캡션에 #프로젝트명(예: #넥서스)을 적으면 그 폴더로 무조건 분류됩니다.");
    }
    for (const kw of keywords) await addProjectKeyword(env, project, kw);
    return sendMessage(env, chatId, "✅ <b>" + project + "</b> 키워드 추가: " + keywords.join(", "));
  }
  if (text.startsWith("/listproject")) {
    const map = await listProjects(env);
    const names = Object.keys(map);
    if (!names.length) return sendMessage(env, chatId, "등록된 프로젝트가 없습니다.");
    const body = names.map(function (p) { return "• <b>" + p + "</b>: " + map[p].join(", "); }).join("\n");
    // 키워드 충돌 진단: 같은 키워드가 2개 이상 프로젝트에 등록되면 오분류 원인이 됨.
    const owners = {}; // 정규화 키워드 → Set(프로젝트)
    for (const p of names) {
      for (const kw of map[p]) {
        const k = String(kw || "").trim().toLowerCase().replace(/[\s\-]/g, "");
        if (!k) continue;
        (owners[k] = owners[k] || new Set()).add(p);
      }
    }
    const clashes = Object.keys(owners)
      .filter(function (k) { return owners[k].size > 1; })
      .map(function (k) { return "  ⚠️ <code>" + k + "</code> → " + Array.from(owners[k]).join(" / "); });
    const warn = clashes.length
      ? "\n\n⚠️ <b>겹치는 키워드(오분류 원인)</b>\n" + clashes.join("\n") +
        "\n같은 키워드가 여러 프로젝트에 있으면 어디로 갈지 임의로 정해집니다. /delproject 로 한쪽을 정리하세요."
      : "";
    return sendMessage(env, chatId, "📑 <b>프로젝트 키워드</b>\n\n" + body + warn);
  }
  if (text.startsWith("/delproject")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const name = text.replace("/delproject", "").trim();
    if (!name) return sendMessage(env, chatId, "형식: /delproject 프로젝트");
    const n = await deleteProject(env, name);
    return sendMessage(env, chatId, n ? ("🗑 <b>" + name + "</b> 키워드 " + n + "개 삭제") : ("'" + name + "' 프로젝트를 찾지 못했습니다."));
  }

  // 프로젝트 하위과제 관리 (권한자만). /project 출력의 └ 항목.
  if (text.startsWith("/addsub")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const arg = text.replace("/addsub", "").trim();
    const parts = arg.split("|");
    const proj = (parts[0] || "").trim();
    const subsRaw = parts.slice(1).join("|").trim();
    if (!proj || !subsRaw) return sendMessage(env, chatId, "형식: /addsub 프로젝트 | 하위과제1,하위과제2");
    const subs = subsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (const s of subs) await addSubtask(env, proj, s);
    return sendMessage(env, chatId, "✅ <b>" + proj + "</b> 하위과제 추가: " + subs.join(", "));
  }
  if (text.startsWith("/listsub")) {
    const rows = await listSubtasks(env);
    if (!rows.length) return sendMessage(env, chatId, "등록된 하위과제가 없습니다.");
    const byProj = {};
    for (const r of rows) { (byProj[r.project] = byProj[r.project] || []).push(r.subtask); }
    const lines = ["📁 <b>프로젝트 하위과제</b>", ""];
    for (const p in byProj) lines.push("• <b>" + p + "</b>: " + byProj[p].join(", "));
    return sendMessage(env, chatId, lines.join("\n"));
  }
  if (text.startsWith("/delsub")) {
    if (!isAdmin(env, msg)) return sendMessage(env, chatId, "권한이 없습니다. /whoami 로 chat_id 확인 후 ADMIN_CHAT_ID 에 등록하세요.");
    const proj = text.replace("/delsub", "").trim();
    if (!proj) return sendMessage(env, chatId, "형식: /delsub 프로젝트");
    await delSubtasks(env, proj);
    return sendMessage(env, chatId, "🗑 <b>" + proj + "</b> 하위과제 삭제");
  }

  // 프로젝트 항목 번호 조회: "1-1", "1-1 요약", "1-1 자료", "1 (1) 요약" (직전 /project 기준)
  const itemMatch = text.match(/^(\d+)\s*[-()\s]+\s*(\d+)\)?\s*(요약|자료|상세)?$/);
  if (itemMatch) {
    const tag = itemMatch[1] + "-" + itemMatch[2];
    const want = itemMatch[3] || "둘다";
    const raw = await env.STATE.get("projmap:" + chatId);
    if (!raw) return sendMessage(env, chatId, "먼저 /project 를 실행해 주세요. (번호는 직전 /project 기준)");
    let map;
    try { map = JSON.parse(raw); } catch { map = {}; }
    const item = map[tag];
    if (!item) return sendMessage(env, chatId, tag + " 항목을 찾을 수 없습니다. /project 를 다시 실행해 주세요.");
    return handleProjectItem(env, chatId, tag, item, want);
  }

  if (text.startsWith("/brief")) return runBrief(env, chatId);
  if (text.startsWith("/decision")) return runBrief(env, chatId); // decision 은 /brief 로 통합
  if (text.startsWith("/info")) {
    const arg = text.replace("/info", "").trim();
    const days = /^\d+$/.test(arg) ? parseInt(arg, 10) : 2; // 기본 전날+당일
    return runInfoBriefing(env, chatId, days);
  }
  if (text.startsWith("/project")) {
    const arg = text.replace("/project", "").trim();
    let days = 7, name = "";
    if (/^\d+$/.test(arg)) {
      days = parseInt(arg, 10);
    } else if (arg) {
      days = null;
      name = arg;
    }
    return runProjectBriefing(env, chatId, days, name);
  }
  async function summarizeDocumentRequest(targetMsg, forceMeeting = false) {
    await sendMessage(env, chatId, "문서를 읽고 회의록/요약을 작성하는 중입니다. 잠시만 기다려주세요.");
    try {
      await enqueueDocumentSummary(env, chatId, targetMsg, { asMeeting: forceMeeting });
    } catch (e) {
      console.error("summarizeDocumentRequest error", e && (e.stack || e.message));
      return sendMessage(env, chatId, "문서 처리 중 오류가 발생했습니다. PDF가 스캔본/암호화 파일이면 텍스트 선택 가능한 PDF, .docx, 또는 .txt로 다시 보내주세요.");
    }
  }
  if (text.startsWith("/summary")) {
    // 녹음이 함께 왔거나 reply 대상이 녹음이면 → 회의록 작성(handleVoice)으로.
    if (isAudioMsg(msg)) { await collectMessage(env, msg); return handleVoice(env, chatId, msg, true); }
    if (isAudioMsg(msg.reply_to_message)) return handleVoice(env, chatId, msg.reply_to_message, true);
    if (isDocumentMsg(msg)) return summarizeDocumentRequest(msg, false);
    if (isDocumentMsg(msg.reply_to_message)) return summarizeDocumentRequest(msg.reply_to_message, false);
    const kw = text.replace("/summary", "").trim();
    return summarizeLatest(env, chatId, kw);
  }
  // "위에 3개 메세지 회의록으로 요약해줘" 등 — 최근 N개 텍스트 메시지를 회의록으로(녹음 아님).
  // '회의록' 단어가 있어도 '메세지/대화 N개'면 녹음이 아니라 최근 메시지를 묶는다. /minutes 보다 먼저.
  const msgCountMatch = text.match(/(\d+)\s*(?:개|건|줄)?\s*(?:dm|디엠)?\s*(?:메세지|메시지|대화)/);
  if ((isDM || isMentioned) && msgCountMatch && /회의록|회의\s*요약|요약|정리/.test(text)) {
    const n = parseInt(msgCountMatch[1], 10) || 30;
    return summarizeRecentMessages(env, chatId, n);
  }
  // 회의록 = STT와 분리된 별도 요청. 평범한 대화에 '회의록' 단어가 있다고 자동 생성하지 않는다.
  // 명령(/minutes)이거나, 봇을 직접 부른(DM·멘션) 자연어이거나, 특정 항목(녹음/문서)에 대한 답장일 때만.
  if (text.startsWith("/minutes")
      || ((isDM || isMentioned) && /회의록|녹취록|녹취|받아쓰기/.test(text))
      || (isAudioMsg(msg.reply_to_message) && /회의록|녹취|받아쓰기|정리|요약/.test(text))) {
    if (isAudioMsg(msg.reply_to_message)) return handleVoice(env, chatId, msg.reply_to_message, true);
    if (isDocumentMsg(msg)) return summarizeDocumentRequest(msg, true);
    if (isDocumentMsg(msg.reply_to_message)) return summarizeDocumentRequest(msg.reply_to_message, true);
    // 텍스트 메시지 reply → 그 발신자 연속 블록을 묶어 회의록 (예전 녹음 끌어오지 않음)
    if (msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption)) {
      return summarizeMessageBlock(env, chatId, msg.reply_to_message);
    }
    return makeMinutesFromStored(env, chatId);
  }
  // 녹음 없이 최근 텍스트 대화를 묶어 회의록으로 정리. 명령 또는 봇을 직접 부른 경우만.
  if (text.startsWith("/회의요약") || ((isDM || isMentioned) && /회의\s*요약/.test(text))) {
    const n = parseInt((text.match(/\d+/) || [])[0], 10) || 30;
    return summarizeRecentMessages(env, chatId, n);
  }
  if (text.startsWith("/q ") || text === "/q") {
    const q = text.replace(/^\/q\s*/, "").trim();
    if (!q) return sendMessage(env, chatId, "질문을 입력해 주세요. 예: /q 어제 회의 결정사항은?");
    return handleQA(env, chatId, q);
  }

  // 오디오(녹음) 판별 — 현재 메시지 또는 reply 대상이 녹음인지.
  function isAudioMsg(m) {
    if (!m) return false;
    return !!(m.voice || m.audio
      || (m.document && (/audio/i.test(m.document.mime_type || "")
          || /\.(ogg|oga|mp3|m4a|wav|aac|opus|flac|amr)$/i.test(m.document.file_name || ""))));
  }
  function isDocumentMsg(m) {
    return !!(m && (m.document || (m.photo && m.photo.length)));
  }
  const selfAudio = isAudioMsg(msg);
  const repliedAudio = isAudioMsg(msg.reply_to_message);

  // ---- silent collection (no auto-reply) ----
  await collectMessage(env, msg);

  if (selfAudio) {
    // 녹음 파일은 명령어 없이도 바로 회의록을 작성한다.
    await handleVoice(env, chatId, msg, true);
    return;
  }
  if (msg.document || (msg.photo && msg.photo.length)) {
    await summarizeFile(env, chatId, msg, wasMentioned);
    return;
  }

  // reply 대상이 녹음이고, 사용자가 회의록/정리/요약을 요청하면 → 그 녹음 회의록 작성.
  if (repliedAudio && /회의록|녹취|받아쓰기|정리|요약|summary/i.test(text)) {
    return handleVoice(env, chatId, msg.reply_to_message, true);
  }
  if (isDocumentMsg(msg.reply_to_message) && text && text.length >= 2 && !text.startsWith("/")) {
    const inst = text;
    return customSummarizeDoc(env, chatId, msg.reply_to_message, inst);
  }

  // text: groups need mention; 1:1 uses natural-language intent classification.
  // (isMentioned·isDM 은 route 상단에서 정의됨)

  // 전달·공유태그·보고문은 '자료 적재'다. 위 collectMessage 로 이미 저장됐으니
  // 자동 응답(브리핑/요약)은 띄우지 않는다. 단, 봇을 직접 멘션했으면 말을 건 것이므로 응답.
  if (isDepositMessage(msg, text) && !isMentioned) return;

  // Both 1:1 and group-mention go through the SAME natural-language routing,
  // so answers are identical in quality. Group: only when mentioned. 1:1: always.
  const cleanText = text;
  if ((isDM && text) || isMentioned) {
    const { intent, target } = await classifyIntent(env, cleanText);
    switch (intent) {
      case "summary":
        if (repliedAudio) return handleVoice(env, chatId, msg.reply_to_message, true);
        return summarizeLatest(env, chatId, target);
      case "project":  return runProjectBriefing(env, chatId, 7, target);
      case "decision": return runBrief(env, chatId);
      case "info":     return runInfoBriefing(env, chatId, 2);
      case "brief":    return runBrief(env, chatId);
      case "question": return handleQA(env, chatId, cleanText);
      default:
        // mentioned => user explicitly addressed the bot, so answer anyway.
        if (isMentioned) return handleQA(env, chatId, cleanText);
        return; // 1:1 + none => silent (info delivery)
    }
  }
}

// 원본 파일 전송: file_id 재전송 우선 → 실패 시 R2 원본 바이트 업로드.
async function sendItemFile(env, chatId, item, fileInfo, caption) {
  if (item.ref) {
    try {
      const r = await sendDocument(env, chatId, item.ref, caption);
      if (r && r.ok) return true;
    } catch (e) { console.error("sendItemFile file_id", e && e.message); }
  }
  if (fileInfo && fileInfo.r2_key && env.R2) {
    try {
      const obj = await env.R2.get(fileInfo.r2_key);
      if (obj) {
        const buf = await obj.arrayBuffer();
        const r = await sendDocumentBytes(env, chatId, buf, fileInfo.filename || "자료", caption);
        if (r && r.ok) return true;
      }
    } catch (e) { console.error("sendItemFile R2", e && e.message); }
  }
  return false;
}

// /project 번호 항목(예: 1-1)의 원본 자료 전송 + 압축 요약 제공.
async function handleProjectItem(env, chatId, tag, item, want) {
  let fileInfo = null;
  if (item.ref) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT filename, r2_key, text FROM files WHERE file_id = ? ORDER BY id DESC LIMIT 1"
      ).bind(item.ref).all();
      if (results && results.length) fileInfo = results[0];
    } catch (e) { console.error("item file lookup", e && e.message); }
  }

  const header = "📌 <b>" + tag + "</b> · " + (item.project || "") + " (" + item.date + ")";

  // 자료: 원본 파일을 실제로 전송
  if (want === "자료" || want === "둘다") {
    const owner = item.sender ? "\n상세한 내용은 원 공유자 " + item.sender + "에게 확인해 주세요." : "";
    const cap = header + owner;
    const ok = await sendItemFile(env, chatId, item, fileInfo, cap);
    if (!ok) {
      await sendMessage(env, chatId, header + "\n📎 원본 파일을 전송할 수 없습니다" +
        (fileInfo && fileInfo.filename ? " (" + fileInfo.filename + ")" : " — 메시지 기반 항목이라 첨부 원본이 없습니다") + ".");
    }
  }

  // 요약: 원문을 압축 요약
  if (want === "요약" || want === "상세" || want === "둘다") {
    const base = String((fileInfo && fileInfo.text) ? fileInfo.text : (item.summary || "")).trim();
    if (!base) {
      await sendMessage(env, chatId, header + "\n(요약할 원문이 없습니다.)");
    } else {
      const sys = "다음 자료를 염성진 사장 보고용으로 '요약'하라. 원문을 그대로 옮기거나 표를 복사하지 말고 핵심만 압축하라.\n" +
        "- 맨 위 한 줄로 결론. 이어서 핵심 포인트 3~6개를 '• '로 짧게.\n" +
        "- 마크다운(표 |---|, #, **, -) 절대 금지. 강조는 <b></b>만. 불릿은 '• '.\n" +
        "- 숫자·날짜·금액·고유명사는 정확히 유지. 없는 내용은 지어내지 말 것.\n" +
        "- 결정·후속 사항이 있으면 마지막에 '결정/후속:' 한두 줄.";
      let detail;
      try {
        detail = await callClaude(env, "자료:\n" + base.slice(0, 12000), sys, MODEL_SMART, 900);
      } catch (e) {
        detail = "(요약 생성 실패) 원문 요지: " + String(item.summary || "").slice(0, 500);
      }
      await sendMessage(env, chatId, header + "\n" + detail);
    }
  }
}
