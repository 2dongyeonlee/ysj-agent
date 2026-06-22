// db.js — D1 쿼리만 담당. SQL 은 전부 여기 모은다.

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

// ===== 파일 (기능2: 자료 전달) =====
export async function saveFile(env, f) {
  await env.DB.prepare(
    `INSERT INTO files (chat_id, file_id, r2_key, filename, text, sender) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(String(f.chat_id), f.file_id || "", f.r2_key || "", f.filename || "", f.text || "", f.sender || "").run();
}

export async function searchFiles(env, keyword) {
  const { results } = await env.DB.prepare(
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
    "SELECT source_type, schedule, category, project, summary, people, followup, done, decision, source, author, report_date, sender, created_at FROM insights WHERE " + where + " ORDER BY created_at DESC LIMIT 100"
  ).bind(...binds).all();
  return results || [];
}

export async function getInfoInsightsSince(env, sinceIso, categories) {
  const list = (categories && categories.length) ? categories : ["정부", "국회", "BH", "글로벌", "언론"];
  const ph = list.map(function () { return "?"; }).join(",");
  const { results } = await env.DB.prepare(
    "SELECT source_type, schedule, category, project, summary, people, author, report_date, sender, created_at, source_ref " +
    "FROM insights WHERE created_at >= ? AND category IN (" + ph + ") AND (project = '' OR project IS NULL) " +
    "AND id IN (SELECT MAX(id) FROM insights GROUP BY COALESCE(NULLIF(source_ref,''), CAST(id AS TEXT))) " +
    "ORDER BY created_at DESC LIMIT 100"
  ).bind(sinceIso, ...list).all();
  return results || [];
}

// 저장 점검(진단용): 최근 insights 를 분류·발신자·경로 그대로 조회. 키워드 있으면 필터.
export async function checkInsights(env, keyword, limit) {
  const lim = limit || 15;
  if (keyword) {
    const kw = "%" + String(keyword).replace(/[%_'"\\]/g, " ").trim() + "%";
    const { results } = await env.DB.prepare(
      "SELECT created_at, source_type, source_ref, category, project, sender, summary FROM insights " +
      "WHERE summary LIKE ? OR people LIKE ? OR sender LIKE ? ORDER BY id DESC LIMIT ?"
    ).bind(kw, kw, kw, lim).all();
    return results || [];
  }
  const { results } = await env.DB.prepare(
    "SELECT created_at, source_type, source_ref, category, project, sender, summary FROM insights ORDER BY id DESC LIMIT ?"
  ).bind(lim).all();
  return results || [];
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
    "FROM insights i WHERE " + where + " ORDER BY lower(i.project), i.created_at ASC LIMIT 50"
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
