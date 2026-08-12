// adapters/r2.js — Cloudflare R2(env.R2) 와 동일한 put/get/delete 모양을
// 로컬 파일시스템으로 구현. R2 키는 'folder/2026-08-11_제목_이름.ext' 처럼
// 슬래시가 섞인 경로라 하위 폴더를 그대로 만들어 대응한다.
// 메타데이터(customMetadata/httpMetadata)는 파일 옆에 '<key>.meta.json' 로 저장.

import fs from "node:fs";
import path from "node:path";

function safePath(baseDir, key) {
  const resolved = path.resolve(baseDir, String(key));
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
    throw new Error("invalid R2 key (path traversal): " + key);
  }
  return resolved;
}

export function createR2(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });

  return {
    async put(key, data, opts) {
      const filePath = safePath(baseDir, key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const buf = data instanceof ArrayBuffer ? Buffer.from(data)
        : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
      fs.writeFileSync(filePath, buf);
      if (opts && (opts.customMetadata || opts.httpMetadata)) {
        fs.writeFileSync(filePath + ".meta.json", JSON.stringify({
          customMetadata: opts.customMetadata || {},
          httpMetadata: opts.httpMetadata || {},
        }));
      }
      return { key };
    },
    async get(key) {
      const filePath = safePath(baseDir, key);
      if (!fs.existsSync(filePath)) return null;
      const buf = fs.readFileSync(filePath);
      let meta = { customMetadata: {}, httpMetadata: {} };
      try {
        if (fs.existsSync(filePath + ".meta.json")) {
          meta = JSON.parse(fs.readFileSync(filePath + ".meta.json", "utf8"));
        }
      } catch (e) { /* 메타 손상 시 기본값 유지 */ }
      return {
        customMetadata: meta.customMetadata,
        httpMetadata: meta.httpMetadata,
        async arrayBuffer() {
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
      };
    },
    async delete(key) {
      const filePath = safePath(baseDir, key);
      try { fs.unlinkSync(filePath); } catch (e) { /* 이미 없으면 무시 */ }
      try { fs.unlinkSync(filePath + ".meta.json"); } catch (e) { /* 무시 */ }
    },
  };
}
