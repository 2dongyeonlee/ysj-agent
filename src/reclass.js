// reclass.js — 기존에 적재된 파일을 개선된 규칙으로 다시 분류하고 R2 폴더를 옮긴다.
// D1 에 저장된 추출 텍스트로 재분류하므로 파일을 다시 받을 필요 없음.
// 파일명/날짜 부분은 그대로 두고 상위 폴더(대분류/중분류)만 교체한다.
// KV 커서로 한 번에 BATCH 건씩 이어서 처리(웹훅 타임아웃 방지).

import { classifyStored } from "./insight.js";
import { r2Folder } from "./collect.js";
import { sendMessage } from "./telegram.js";

const BATCH = 10;
const CURSOR_KEY = "reclass_cursor";

// 기존 키에서 파일명 부분(마지막 / 뒤)만 떼어 폴더만 교체.
function swapFolder(oldKey, folder) {
  const i = String(oldKey || "").lastIndexOf("/");
  const fname = i === -1 ? String(oldKey || "") : oldKey.slice(i + 1);
  return folder + "/" + fname;
}

export async function runReclass(env, chatId, reset) {
  if (reset) await env.STATE.delete(CURSOR_KEY);
  const cursor = Number((await env.STATE.get(CURSOR_KEY)) || "0");

  const { results } = await env.DB.prepare(
    "SELECT id, r2_key, filename, text FROM files " +
    "WHERE id > ? AND r2_key != '' AND r2_key IS NOT NULL AND r2_key NOT LIKE 'migrated/%' " +
    "ORDER BY id ASC LIMIT ?"
  ).bind(cursor, BATCH).all();
  const rows = results || [];

  if (!rows.length) {
    await env.STATE.delete(CURSOR_KEY);
    return sendMessage(env, chatId,
      cursor ? "♻️ 재분류: 전체 완료. 처음부터 다시 하려면 /reclass reset."
             : "재분류할 파일이 없습니다.");
  }

  let moved = 0, kept = 0, fail = 0, last = cursor;
  for (const row of rows) {
    last = row.id;
    try {
      const cls = await classifyStored(env, { text: row.text, filename: row.filename, caption: "" });
      const newKey = swapFolder(row.r2_key, r2Folder(cls));
      if (newKey === row.r2_key) { kept++; continue; }

      const obj = await env.R2.get(row.r2_key);
      if (!obj) { fail++; continue; }
      const data = await obj.arrayBuffer();
      await env.R2.put(newKey, data, {
        customMetadata: obj.customMetadata,
        httpMetadata: obj.httpMetadata,
      });
      await env.R2.delete(row.r2_key);
      await env.DB.prepare("UPDATE files SET r2_key = ? WHERE id = ?").bind(newKey, row.id).run();
      moved++;
    } catch (e) {
      console.error("reclass row error", row.id, e && e.message);
      fail++;
    }
  }

  const more = rows.length === BATCH;
  if (more) await env.STATE.put(CURSOR_KEY, String(last), { expirationTtl: 3600 });
  else await env.STATE.delete(CURSOR_KEY);

  return sendMessage(env, chatId,
    "♻️ 재분류 " + rows.length + "건 처리: 이동 " + moved + " · 유지 " + kept + " · 실패 " + fail +
    (more ? "\n계속하려면 /reclass 다시 실행." : "\n전체 완료."));
}
