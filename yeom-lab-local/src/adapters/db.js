// adapters/db.js — Cloudflare D1(env.DB) 와 동일한 호출 모양을 better-sqlite3 로 구현.
// 기존 src/*.js 는 전부 env.DB.prepare(sql).bind(...args).run()/.all()/.first() 형태만
// 쓰므로, 이 세 메서드만 D1과 동일한 반환 모양(run→{meta:{changes,last_row_id}},
// all→{results:[...]}, first→row|null)으로 맞추면 비즈니스 로직은 한 줄도 안 바꿔도 된다.

import Database from "better-sqlite3";

export function createD1(dbPath) {
  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  return {
    _raw: raw,
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        bind(...args) {
          // D1 bind 는 undefined 를 허용하지 않지만, 기존 코드가 종종 undefined 를 넘긴다.
          // sqlite 는 undefined 바인딩 시 예외를 던지므로 null 로 치환.
          const safeArgs = args.map((a) => (a === undefined ? null : a));
          return {
            async run() {
              const info = stmt.run(...safeArgs);
              return {
                success: true,
                meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
              };
            },
            async all() {
              const results = stmt.all(...safeArgs);
              return { results };
            },
            async first() {
              const row = stmt.get(...safeArgs);
              return row === undefined ? null : row;
            },
          };
        },
        // bind 없이 바로 실행하는 코드 경로 대비(현재 코드베이스엔 없지만 안전망).
        async run() {
          const info = stmt.run();
          return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
        async all() {
          return { results: stmt.all() };
        },
        async first() {
          const row = stmt.get();
          return row === undefined ? null : row;
        },
      };
    },
  };
}
