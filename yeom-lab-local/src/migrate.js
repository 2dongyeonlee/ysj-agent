// migrate.js — migrations/*.sql 를 번호 순서로 로컬 sqlite에 적용.
// 이미 적용한 파일은 _migrations 테이블에 기록해 재실행 시 건너뛴다.
// (D1 마이그레이션 중 일부는 ALTER TABLE ADD COLUMN 재실행 시 'duplicate column'
//  으로 실패하는데 그건 GitHub Actions 로그에서도 무시하고 넘어가던 것과 동일 — 여기선
//  아예 파일 단위로 1회만 실행해 그 문제 자체가 생기지 않는다.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

export function runMigrations(raw) {
  raw.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)"
  );
  const applied = new Set(
    raw.prepare("SELECT filename FROM _migrations").all().map((r) => r.filename)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      raw.exec(sql);
      raw.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
      ran++;
      console.log("migrated:", file);
    } catch (e) {
      console.error("migration failed:", file, e.message);
      throw e;
    }
  }
  if (ran === 0) console.log("migrations: up to date (" + files.length + " applied)");
  else console.log("migrations: " + ran + "건 적용 완료");
}
