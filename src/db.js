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
    `INSERT INTO files (chat_id, file_id, r2_key, filename, text) VALUES (?, ?, ?, ?, ?)`
  ).bind(String(f.chat_id), f.file_id || "", f.r2_key || "", f.filename || "", f.text || "").run();
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
    `SELECT * FROM contacts WHERE name LIKE ? OR aliases LIKE ? LIMIT 5`
  ).bind(`%${name}%`, `%${name}%`).all();
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
