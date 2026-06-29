// db.js — D1 쿼리만 담당. SQL 은 전부 여기 모은다.
import { NAME_ALIASES } from "./people.js";

// ===== 메시지 (브리핑·검색 원천) =====
export async function saveMessage(env, m) {
  await env.DB.prepare(
    `INSERT INTO messages (chat_id, message_id, sender, text) VALUES (?, ?, ?, ?)`
  ).bind(String(m.chat_id), String(m.message_id || ""), m.sender || "", m.text || "").run();
}

export async function getMessagesSince(env, chatIds, sinceIso) {
  const ph = chatIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT chat_id, sender, text, created_at FROM messages
     WHERE chat_id IN (${ph}) AND created_at >= ? ORDER BY created_at ASC`
  ).bind(...chatIds, sinceIso).all();
  return results || [];
}

// 내용기반 중복제거: 같은 방에서 동일 본문이 최근(sinceIso 이후) 이미 저장됐는지.
// 현재 메시지(excludeMsgId)는 제외. forward/붙여넣기로 같은 자료를 여러 번 넣어도
// insight 가 중복 생성되지 않게 하는 근거.
export async function priorIdenticalMessage(env, chatId, text, excludeMsgId, sinceIso) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM messages
     WHERE chat_id = ? AND message_id != ? AND text = ? AND created_at >= ? LIMIT 1`
  ).bind(String(chatId), String(excludeMsgId || ""), String(text || ""), sinceIso).first();
  return !!row;
}

// 키워드로 메시지 검색 (기능2: 자료/내용 찾기)
export async function searchMessages(env, keyword) {
  const { results } = await env.DB.prepare(
    `SELECT chat_id, sender, text, created_at FROM messages
     WHERE text LIKE ? ORDER BY created_at DESC LIMIT 20`
  ).bind(`%${keyword}%`).all();
  return results || [];
}

// created_at 은 'YYYY-MM-DD HH:MM:SS' (UTC) 로 저장됨 → 같은 형식으로 비교해야 함.
function toDbTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// KST 자정 기준 → UTC → DB 형식 문자열
function kstDayStartDb(offsetDays = 0) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return toDbTime(new Date(kst.getTime() - 9 * 3600 * 1000));
}

function dateRangeFromQuery(q) {
  const s = String(q || "");
  if (/어제|전일/.test(s)) return { since: kstDayStartDb(-1), until: kstDayStartDb(0) };
  if (/이번\s*주|금주|이번주/.test(s)) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const dow = (kst.getUTCDay() + 6) % 7;   // 월=0
    return { since: kstDayStartDb(-dow), until: null };
  }
  if (/오늘|금일/.test(s)) return { since: kstDayStartDb(0), until: null };
  return { since: null, until: null };
}

export async function searchBySender(env, query, opts = {}) {
  const pat = /^(.+?)\s*(TL|팀장|담당|씨|님|이|가|은|는)?\s*(보고한|공유한|공유해준|말한|언급한|올린|전달한|작성한|보낸|이야기한)/;
  const m = String(query || "").match(pat);
  if (!m) return null;

  const nameRaw = m[1]
    .replace(/(어제|오늘|이번주|금주|최근|아까|전일|금일)\s*/g, "")
    .replace(/\s*(담당|팀장|TL|사장|님|씨|이|가|은|는)+\s*$/g, "")
    .trim();
  if (nameRaw.length < 2) return null;

  const aliases = Object.entries(NAME_ALIASES).find(([full, list]) =>
    full.includes(nameRaw) || list.some(a => a.includes(nameRaw) || nameRaw.includes(a))
  );
  if (!aliases) return null;

  const [full, aliasList] = aliases;
  const likes = aliasList.map(() => "sender LIKE ?").join(" OR ");
  const likeBinds = aliasList.map(a => `%${a}%`);

  const range = opts.noDate ? { since: null, until: null } : dateRangeFromQuery(query);
  const dateConds = [], dateBinds = [];
  if (range.since) { dateConds.push("created_at >= ?"); dateBinds.push(range.since); }
  if (range.until) { dateConds.push("created_at < ?");  dateBinds.push(range.until); }
  const extra = dateConds.length ? " AND " + dateConds.join(" AND ") : "";

  // 한 측(messages/files) 바인드 = likeBinds + dateBinds. UNION이라 두 번 반복.
  const oneBinds = [...likeBinds, ...dateBinds];
  try {
    const { results } = await env.DB.prepare(
      `SELECT sender, text, created_at, '' AS filename FROM messages
        WHERE (${likes}) AND length(text) >= 5${extra}
       UNION ALL
       SELECT sender, text, created_at, filename FROM files
        WHERE (${likes}) AND text != ''${extra}
       ORDER BY created_at DESC LIMIT 10`
    ).bind(...oneBinds, ...oneBinds).all();
    return { name: full, rows: results || [], ranged: !!range.since };
  } catch (e) {
    console.error("searchBySender error:", e.message);
    return { name: full, rows: [], ranged: !!range.since };
  }
}

export async function searchAll(env, query) {
  const q = String(query || "");

  // "회의" 질문은 주제 키워드보다 기간 내 회의록 전체를 우선한다.
  if (/회의|미팅|간담회|티미팅/.test(q)) {
    const k = new Date(Date.now() + 9 * 3600 * 1000);
    k.setUTCHours(0, 0, 0, 0);
    const days = /이번\s*주|금주|최근|일주일/.test(q) ? 7 : (/오늘|금일/.test(q) ? 1 : 7);
    k.setUTCDate(k.getUTCDate() - (days - 1));
    const since = new Date(k.getTime() - 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    try {
      const mtFile = await env.DB.prepare(
        `SELECT 'file' AS src, sender, COALESCE(full_minutes,text) AS body, filename, doc_type, '' AS project, created_at
           FROM files WHERE created_at >= ? AND text != '' AND text NOT LIKE '[%'
             AND (doc_type='meeting' OR filename LIKE '%.m4a' OR filename LIKE '%녹음%'
               OR filename LIKE '%면담%' OR filename LIKE '%회의%' OR filename LIKE '%Monthly%'
               OR filename LIKE '%브리프%' OR filename LIKE '%티미팅%')
           ORDER BY created_at DESC LIMIT 12`
      ).bind(since).all();

      const mtMsg = await env.DB.prepare(
        `SELECT 'msg' AS src, sender, text AS body, '' AS filename, '' AS doc_type, '' AS project, created_at
           FROM messages WHERE created_at >= ?
             AND (text LIKE '회의록%' OR text LIKE '%협의회%' OR text LIKE '%임원티미팅%'
               OR text LIKE '%간담회%' OR text LIKE '%면담%') AND length(text) > 50
           ORDER BY created_at DESC LIMIT 10`
      ).bind(since).all();

      const merged = [...(mtFile.results || []), ...(mtMsg.results || [])];
      if (merged.length) {
        const seen = new Set();
        return merged.filter(function (r) {
          const key = r.filename || String(r.body || "").slice(0, 40);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    } catch (e) { console.error("searchAll meeting", e.message); }
  }

  const stop = /(알려줘|요약해줘|요약|정리해줘|정리|해줘|뭐야|어떻게|언제|관련|내용|좀|the)/g;
  const kw = q.replace(/[?？!！.]/g, " ").replace(stop, " ")
    .trim().split(/\s+/).filter(function (w) { return w.length >= 2; });
  if (!kw.length) kw.push(q.slice(0, 8));

  const out = [];
  const likeM = kw.map(function () { return "text LIKE ?"; }).join(" OR ");
  try {
    const m = await env.DB.prepare(
      `SELECT 'msg' AS src, sender, text AS body, '' AS filename, '' AS doc_type, '' AS project, created_at
         FROM messages WHERE ${likeM} ORDER BY created_at DESC LIMIT 15`
    ).bind(...kw.map(function (k) { return "%" + k + "%"; })).all();
    out.push(...(m.results || []));
  } catch (e) { console.error("searchAll msg", e.message); }

  try {
    const f = await env.DB.prepare(
      `SELECT 'file' AS src, sender, COALESCE(full_minutes, text) AS body, filename, doc_type, '' AS project, created_at
         FROM files WHERE (${likeM}) AND text != '' ORDER BY created_at DESC LIMIT 10`
    ).bind(...kw.map(function (k) { return "%" + k + "%"; })).all();
    out.push(...(f.results || []));
  } catch (e) { console.error("searchAll file", e.message); }

  try {
    const likeI = kw.map(function () { return "summary LIKE ?"; }).join(" OR ");
    const i = await env.DB.prepare(
      `SELECT 'insight' AS src, sender, summary AS body, '' AS filename, '' AS doc_type, project, created_at
         FROM insights WHERE ${likeI} ORDER BY created_at DESC LIMIT 15`
    ).bind(...kw.map(function (k) { return "%" + k + "%"; })).all();
    out.push(...(i.results || []));
  } catch (e) { console.error("searchAll insight", e.message); }

  return out;
}

// ===== 파일 (기능2: 자료 전달) =====
export async function saveFile(env, f) {
  if (f.file_id && f.chat_id) {
    const existing = await env.DB.prepare(
      `SELECT id FROM files WHERE file_id = ? AND chat_id = ? LIMIT 1`
    ).bind(f.file_id || "", String(f.chat_id)).first();
    if (existing) return existing.id;
  }
  await env.DB.prepare(
    `INSERT INTO files (chat_id, file_id, r2_key, filename, text, sender, doc_type, full_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    String(f.chat_id),
    f.file_id || "",
    f.r2_key || "",
    f.filename || "",
    f.text || "",
    f.sender || "",
    f.doc_type || "",
    f.full_minutes || null
  ).run();
}

// 같은 녹음/파일을 이미 처리해 전사문(text)을 저장해 뒀는지 file_id 로 조회.
// 있으면 재전사 없이 그 텍스트를 재사용한다.
export async function getFileTextByFileId(env, fileId) {
  if (!fileId) return "";
  const { results } = await env.DB.prepare(
    `SELECT text FROM files WHERE file_id = ? AND text != '' ORDER BY created_at DESC LIMIT 1`
  ).bind(String(fileId)).all();
  return (results && results[0] && results[0].text) || "";
}

export async function searchFiles(env, keyword) {  const { results } = await env.DB.prepare(
    `SELECT file_id, r2_key, filename, text FROM files
     WHERE filename LIKE ? OR text LIKE ? ORDER BY created_at DESC LIMIT 10`
  ).bind(`%${keyword}%`, `%${keyword}%`).all();
  return results || [];
}

// ===== 접촉이력 (기능3·4: 누구 만났는지) =====
export async function findContact(env, name) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM contacts WHERE name = ? OR aliases = ? LIMIT 5`
  ).bind(String(name || "").trim(), String(name || "").trim()).all();
  return results || [];
}

export async function insertContact(env, c) {
  const r = await env.DB.prepare(
    `INSERT INTO contacts (name, org, title, rel_type, aliases) VALUES (?, ?, ?, ?, ?)`
  ).bind(c.name, c.org || "", c.title || "", c.rel_type || "", c.aliases || "").run();
  return r.meta?.last_row_id;
}

export async function insertEngagement(env, e) {
  await env.DB.prepare(
    `INSERT INTO engagements (contact_id, met_at, topic, channel, summary, followup, source_type, source_ref, raw_input, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    e.contact_id || null, e.met_at || "", e.topic || "", e.channel || "",
    e.summary || "", e.followup || "", e.source_type || "", e.source_ref || "",
    e.raw_input || "", e.created_by || ""
  ).run();
}

// 최근 접촉 전체 (기능3: 만난 사람 브리핑)
export async function getRecentEngagements(env, sinceIso) {
  const { results } = await env.DB.prepare(
    `SELECT e.met_at, e.topic, e.summary, c.name, c.org
     FROM engagements e LEFT JOIN contacts c ON c.id = e.contact_id
     WHERE e.met_at >= ? ORDER BY e.met_at DESC LIMIT 30`
  ).bind(sinceIso).all();
  return results || [];
}

// 특정 인물의 과거 접촉 (기능4: 만나기 전 브리핑)
export async function getEngagementsByContact(env, contactId) {
  const { results } = await env.DB.prepare(
    `SELECT met_at, topic, summary, followup FROM engagements
     WHERE contact_id = ? ORDER BY met_at DESC LIMIT 10`
  ).bind(contactId).all();
  return results || [];
}

// 주제로 접촉 검색 ("X건으로 누구 만났지")
export async function searchEngagementsByTopic(env, topic) {
  const { results } = await env.DB.prepare(
    `SELECT e.met_at, e.topic, e.summary, c.name, c.org
     FROM engagements e LEFT JOIN contacts c ON c.id = e.contact_id
     WHERE e.topic LIKE ? ORDER BY e.met_at DESC LIMIT 20`
  ).bind(`%${topic}%`).all();
  return results || [];
}

// 전체 방의 메시지 조회 (대외정보/프로젝트 브리핑용)
export async function getAllMessagesSince(env, sinceIso) {
  const { results } = await env.DB.prepare(
    `SELECT chat_id, sender, text, created_at FROM messages
     WHERE created_at >= ? ORDER BY created_at ASC`
  ).bind(sinceIso).all();
  return results || [];
}

// insights 조회 (브리핑이 messages 대신/함께 읽음)
export async function getInsightsSince(env, sinceIso, filter) {
  let where = "created_at >= ?";
  const binds = [sinceIso];
  if (filter && filter.category) { where += " AND category = ?"; binds.push(filter.category); }
  if (filter && filter.categoryIn && filter.categoryIn.length) {
    where += " AND category IN (" + filter.categoryIn.map(function () { return "?"; }).join(",") + ")";
    binds.push(...filter.categoryIn);
  }
  if (filter && filter.project)  { where += " AND project = ?";  binds.push(filter.project); }
  if (filter && filter.projectEmpty) { where += " AND (project = '' OR project IS NULL)"; }
  if (filter && filter.projectNotEmpty) { where += " AND project != '' AND project IS NOT NULL"; }
  if (filter && filter.sourceType) { where += " AND source_type = ?"; binds.push(filter.sourceType); }
  if (filter && filter.hasSchedule) { where += " AND schedule != ''"; }
  const { results } = await env.DB.prepare(
    "SELECT source_type, source_ref, schedule, category, project, summary, people, followup, done, decision, source, author, report_date, sender, created_at, " +
    "(SELECT text FROM messages m WHERE m.message_id = CASE WHEN instr(insights.source_ref, '#') > 0 THEN substr(insights.source_ref, 1, instr(insights.source_ref, '#') - 1) ELSE insights.source_ref END ORDER BY created_at DESC LIMIT 1) AS raw_message, " +
    "(SELECT text FROM files f WHERE f.file_id = insights.source_ref ORDER BY id DESC LIMIT 1) AS raw_file " +
    "FROM insights WHERE " + where + " ORDER BY created_at DESC LIMIT 100"
  ).bind(...binds).all();
  return results || [];
}

// 재요약 대상: 최근 insights + 원문(messages.text / files.text). 원문 있는 것만 재요약 가능.
// onlyThin=true 면 요약이 짧거나 막연한(빈약한) 것만 대상으로.
export async function getResummaryTargets(env, limit, onlyThin) {
  const lim = limit || 25;
  const rows = (await env.DB.prepare(
    "SELECT id, source_type, source_ref, summary, category, project, " +
    "(SELECT text FROM messages m WHERE m.message_id = CASE WHEN instr(insights.source_ref, '#') > 0 THEN substr(insights.source_ref, 1, instr(insights.source_ref, '#') - 1) ELSE insights.source_ref END ORDER BY created_at DESC LIMIT 1) AS raw_message, " +
    "(SELECT text FROM files f WHERE f.file_id = insights.source_ref ORDER BY id DESC LIMIT 1) AS raw_file " +
    "FROM insights ORDER BY id DESC LIMIT ?"
  ).bind(onlyThin ? lim * 4 : lim).all()).results || [];
  const out = [];
  for (const r of rows) {
    const raw = String(r.raw_message || r.raw_file || "").trim();
    if (raw.length < 20) continue;                 // 원문 없으면 재요약 불가
    if (onlyThin) {
      const s = String(r.summary || "").replace(/\s+/g, "");
      const thin = s.length < 18 || /확인 필요|내용 확인|^사장님|발표 예정$|보고$|보고임$/.test(String(r.summary || ""));
      if (!thin) continue;
    }
    out.push(r);
    if (out.length >= lim) break;
  }
  return out;
}

export async function updateInsightSummary(env, id, summary, people, schedule) {
  await env.DB.prepare(
    "UPDATE insights SET summary = ?, " +
    "people = CASE WHEN ? != '' THEN ? ELSE people END, " +
    "schedule = CASE WHEN ? != '' THEN ? ELSE schedule END WHERE id = ?"
  ).bind(String(summary || "").slice(0, 500), people || "", people || "", schedule || "", schedule || "", id).run();
}

export async function getInfoInsightsSince(env, sinceIso, categories) {
  const list = (categories && categories.length) ? categories : ["정부", "국회", "BH", "글로벌", "언론"];
  const ph = list.map(function () { return "?"; }).join(",");
  const { results } = await env.DB.prepare(
    "SELECT source_type, schedule, category, project, summary, people, author, report_date, sender, created_at, source_ref, " +
    "(SELECT text FROM messages m WHERE m.message_id = CASE WHEN instr(i.source_ref, '#') > 0 THEN substr(i.source_ref, 1, instr(i.source_ref, '#') - 1) ELSE i.source_ref END ORDER BY created_at DESC LIMIT 1) AS raw_message, " +
    "(SELECT text FROM files f WHERE f.file_id = i.source_ref ORDER BY id DESC LIMIT 1) AS raw_file " +
    "FROM insights i WHERE i.created_at >= ? AND i.category IN (" + ph + ") AND (i.project = '' OR i.project IS NULL) " +
    "AND ( " +
    "  i.summary LIKE '%일간 글로벌%' OR i.summary LIKE '%Daily%' OR i.summary LIKE '%경영환경%' " +
    "  OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.message_id = CASE WHEN instr(i.source_ref,'#')>0 THEN substr(i.source_ref,1,instr(i.source_ref,'#')-1) ELSE i.source_ref END AND (m2.text LIKE '%<Daily>%' OR m2.text LIKE '%일간 글로벌 정책 브리핑%' OR m2.text LIKE '%경영환경%')) " +
    "  OR EXISTS (SELECT 1 FROM files f2 WHERE f2.file_id = i.source_ref AND f2.text LIKE '%경영환경%') " +
    ") " +
    "AND i.id IN (SELECT MAX(id) FROM insights GROUP BY COALESCE(NULLIF(source_ref,''), CAST(id AS TEXT))) " +
    "ORDER BY created_at DESC LIMIT 100"
  ).bind(sinceIso, ...list).all();
  return results || [];
}

// 저장 점검(진단용): 최근 insights 를 분류·발신자·경로 그대로 조회. 키워드 있으면 필터.
// 각 행에 dupkey(중복 판정 키)를 붙인다 — 같은 원문(메시지 텍스트)+같은 섹션이면 중복.
// (다항목 브리핑의 서로 다른 섹션은 source_ref 의 #N 으로 구분되어 중복으로 오인하지 않는다.)
export async function checkInsights(env, keyword, limit) {
  const lim = limit || 15;
  let rows;
  if (keyword) {
    const kw = "%" + String(keyword).replace(/[%_'"\\]/g, " ").trim() + "%";
    rows = (await env.DB.prepare(
      "SELECT id, created_at, source_type, source_ref, category, project, sender, summary FROM insights " +
      "WHERE summary LIKE ? OR people LIKE ? OR sender LIKE ? ORDER BY id DESC LIMIT ?"
    ).bind(kw, kw, kw, lim).all()).results || [];
  } else {
    rows = (await env.DB.prepare(
      "SELECT id, created_at, source_type, source_ref, category, project, sender, summary FROM insights ORDER BY id DESC LIMIT ?"
    ).bind(lim).all()).results || [];
  }

  // message 원천 행의 원문을 한 번에 조회(중복 판정 근거). 파일/음성은 요약을 근거로.
  const baseIds = [];
  for (const r of rows) {
    if (r.source_type === "message" && r.source_ref) {
      const base = String(r.source_ref).split("#")[0];
      if (base && baseIds.indexOf(base) === -1) baseIds.push(base);
    }
  }
  const textById = {};
  if (baseIds.length) {
    const ph = baseIds.map(function () { return "?"; }).join(",");
    const mr = (await env.DB.prepare(
      "SELECT message_id, text FROM messages WHERE message_id IN (" + ph + ")"
    ).bind(...baseIds).all()).results || [];
    for (const m of mr) textById[String(m.message_id)] = m.text || "";
  }
  const norm = function (s) { return String(s || "").replace(/\s+/g, "").toLowerCase().slice(0, 160); };
  for (const r of rows) {
    const ref = String(r.source_ref || "");
    const suffix = ref.indexOf("#") !== -1 ? ref.split("#")[1] : "";
    let basis = r.summary;
    if (r.source_type === "message" && ref) basis = textById[ref.split("#")[0]] || r.summary;
    r.dupkey = (r.source_type || "") + "##" + suffix + "##" + norm(basis);
  }
  return rows;
}

// 중복 insight 정리: 같은 내용이 여러 번 저장된 것을 그룹으로 묶어
// '가장 먼저 저장된 1건(원본)'만 남기고 나머지를 삭제 대상으로 본다.
//  - 음성/파일: 같은 source_ref(file_id) = 같은 원본 = 중복
//  - 메시지: 같은 섹션(#N) + 같은 원문(messages.text 정규화) = 중복
// execute=false 면 미리보기(계산만), true 면 실제 삭제. 결과 통계를 반환.
export async function dedupInsights(env, execute) {
  const rows = (await env.DB.prepare(
    "SELECT id, source_type, source_ref, summary FROM insights ORDER BY id ASC"
  ).all()).results || [];

  // 메시지 원천의 원문을 청크로 일괄 조회
  const baseIds = [];
  for (const r of rows) {
    if (r.source_type === "message" && r.source_ref) {
      const base = String(r.source_ref).split("#")[0];
      if (base && baseIds.indexOf(base) === -1) baseIds.push(base);
    }
  }
  const textById = {};
  for (let i = 0; i < baseIds.length; i += 100) {
    const chunk = baseIds.slice(i, i + 100);
    const ph = chunk.map(function () { return "?"; }).join(",");
    const mr = (await env.DB.prepare(
      "SELECT message_id, text FROM messages WHERE message_id IN (" + ph + ")"
    ).bind(...chunk).all()).results || [];
    for (const m of mr) textById[String(m.message_id)] = m.text || "";
  }
  const norm = function (s) { return String(s || "").replace(/\s+/g, "").toLowerCase().slice(0, 160); };

  const groups = {};
  for (const r of rows) {
    const ref = String(r.source_ref || "");
    let key;
    if ((r.source_type === "voice" || r.source_type === "file") && ref) {
      key = r.source_type + "::ref::" + ref;          // 같은 녹음/파일 = 중복
    } else if (r.source_type === "message" && ref) {
      const suffix = ref.indexOf("#") !== -1 ? ref.split("#")[1] : "";
      const txt = textById[ref.split("#")[0]] || r.summary;
      key = "message::" + suffix + "::" + norm(txt);   // 같은 섹션+원문 = 중복
    } else {
      key = (r.source_type || "") + "::sum::" + norm(r.summary);
    }
    (groups[key] = groups[key] || []).push(r);
  }

  const deleteIds = [];
  let groupCount = 0;
  for (const k in groups) {
    const g = groups[k];
    if (g.length <= 1) continue;
    groupCount++;
    for (let i = 1; i < g.length; i++) deleteIds.push(g[i].id); // g[0]=가장 먼저(원본) 보존
  }

  if (execute && deleteIds.length) {
    for (let i = 0; i < deleteIds.length; i += 100) {
      const chunk = deleteIds.slice(i, i + 100);
      const ph = chunk.map(function () { return "?"; }).join(",");
      await env.DB.prepare("DELETE FROM insights WHERE id IN (" + ph + ")").bind(...chunk).run();
    }
  }
  return { total: rows.length, groupCount: groupCount, deleteCount: deleteIds.length };
}

export async function getProjectTimeline(env, project, sinceIso) {
  const name = String(project || "").trim();
  let where = "i.project != '' AND i.project IS NOT NULL";
  const binds = [];
  if (name) { where += " AND i.project LIKE ?"; binds.push("%" + name + "%"); }
  if (sinceIso) { where += " AND i.created_at >= ?"; binds.push(sinceIso); }
  const { results } = await env.DB.prepare(
    "SELECT i.schedule, i.project, i.summary, i.people, i.sender, i.created_at, i.source_ref, " +
    "(SELECT filename FROM files f WHERE f.file_id = i.source_ref ORDER BY id DESC LIMIT 1) AS filename " +
    "FROM insights i WHERE " + where + " ORDER BY lower(i.project), i.created_at ASC LIMIT 200"
  ).bind(...binds).all();
  return results || [];
}

// ===== 프로젝트 하위과제 (project_subtasks) — /addsub 로 등록 =====
export async function addSubtask(env, project, sub) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS project_subtasks (project TEXT, subtask TEXT, UNIQUE(project, subtask))"
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO project_subtasks (project, subtask) VALUES (?, ?)"
  ).bind(String(project || "").trim(), String(sub || "").trim()).run();
}

export async function getSubtasks(env, project) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT subtask FROM project_subtasks WHERE project LIKE ? ORDER BY subtask"
    ).bind("%" + String(project || "").trim() + "%").all();
    return (results || []).map(function (r) { return r.subtask; });
  } catch (e) { return []; }
}

export async function listSubtasks(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT project, subtask FROM project_subtasks ORDER BY project, subtask"
    ).all();
    return results || [];
  } catch (e) { return []; }
}

export async function delSubtasks(env, project) {
  await env.DB.prepare(
    "DELETE FROM project_subtasks WHERE project = ?"
  ).bind(String(project || "").trim()).run();
}

// ===== 프로젝트 키워드 분류 (0007) =====

// 모든 {project, keyword} 반환 (분류 시 사전 로드)
export async function getProjectKeywords(env) {
  const { results } = await env.DB.prepare(
    "SELECT project, keyword FROM project_keywords ORDER BY length(keyword) DESC"
  ).all();
  return results || [];
}

// 키워드 추가 (keyword 는 소문자로 저장)
export async function addProjectKeyword(env, project, keyword) {
  await env.DB.prepare(
    "INSERT INTO project_keywords (project, keyword) VALUES (?, ?)"
  ).bind(String(project).trim(), String(keyword).trim().toLowerCase()).run();
}

// 프로젝트별 키워드 목록 (project -> [keyword,...])
export async function listProjects(env) {
  const { results } = await env.DB.prepare(
    "SELECT project, keyword FROM project_keywords ORDER BY project, keyword"
  ).all();
  const map = {};
  for (const r of (results || [])) {
    if (!map[r.project]) map[r.project] = [];
    map[r.project].push(r.keyword);
  }
  return map;
}

// 해당 프로젝트의 키워드 전체 삭제
export async function deleteProject(env, project) {
  const r = await env.DB.prepare(
    "DELETE FROM project_keywords WHERE project = ?"
  ).bind(String(project).trim()).run();
  return (r.meta && r.meta.changes) || 0;
}

// 해당 프로젝트의 미완료 후속 항목을 완료(done=1) 처리
export async function updateInsightDone(env, project) {
  const r = await env.DB.prepare(
    "UPDATE insights SET done = 1 WHERE project = ? AND done = 0"
  ).bind(String(project).trim()).run();
  return (r.meta && r.meta.changes) || 0;
}

// ── 단일 KV 키 FIFO 큐 (KV list() 일일 한도 회피용) ─────────────────────────
// q:<name> 하나의 키에 JSON 배열로 보관. list() 대신 get/put 만 사용한다.
export async function qPush(env, name, item, dedup) {
  const k = "q:" + name;
  let arr = [];
  try { arr = JSON.parse((await env.STATE.get(k)) || "[]"); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  if (dedup) {
    const s = JSON.stringify(item);
    arr = arr.filter(function (x) { return JSON.stringify(x) !== s; });
  }
  arr.push(item);
  if (arr.length > 50) arr = arr.slice(-50); // 폭주 방지
  await env.STATE.put(k, JSON.stringify(arr), { expirationTtl: 3600 });
}

export async function qShift(env, name) {
  const k = "q:" + name;
  let arr = [];
  try { arr = JSON.parse((await env.STATE.get(k)) || "[]"); } catch (e) { arr = []; }
  if (!Array.isArray(arr) || !arr.length) return null; // 비었으면 put 안 함(쓰기 절약)
  const item = arr.shift();
  await env.STATE.put(k, JSON.stringify(arr), { expirationTtl: 3600 });
  return item;
}

export async function qLen(env, name) {
  try {
    const arr = JSON.parse((await env.STATE.get("q:" + name)) || "[]");
    return Array.isArray(arr) ? arr.length : 0;
  } catch (e) { return 0; }
}
