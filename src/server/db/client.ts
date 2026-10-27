import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_PATH } from "@/lib/paths";

// Node 내장 SQLite(node:sqlite, Node 22.13+)를 쓴다. 예전에는 better-sqlite3를 썼는데,
// Windows + 최신 Node에서 미리 빌드된 바이너리를 못 받으면 소스 빌드(Python + VS C++ 빌드
// 도구)를 요구해 npm install 자체가 실패했다(사용자 PC에서 실제로 발생). 내장 모듈은 설치가 없다.
// process.getBuiltinModule로 불러오는 이유: 번들러가 비교적 새 내장 모듈인 "node:sqlite"를
// 외부 모듈로 인식하지 못하고 번들하려다 실패하는 경우를 피하기 위해.
type DB = DatabaseSync;
type SqliteModule = typeof import("node:sqlite");

// dev 핫리로드 때마다 새 연결을 만들지 않도록 globalThis에 캐싱
const globalForDb = globalThis as unknown as { __naverBlogDb?: DB };

const SCHEMA_PATH = path.join(process.cwd(), "src", "server", "db", "schema.sql");

function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

// CREATE TABLE IF NOT EXISTS는 이미 만들어진 기존 DB에 새 컬럼을 추가해주지 않는다.
// 나중에 추가된 컬럼은 반드시 여기서 존재 여부를 확인한 뒤 ALTER TABLE로 넣는다.
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "runs", column: "detail", ddl: "ALTER TABLE runs ADD COLUMN detail TEXT" },
  { table: "drafts", column: "business_name", ddl: "ALTER TABLE drafts ADD COLUMN business_name TEXT" },
  { table: "drafts", column: "report_json", ddl: "ALTER TABLE drafts ADD COLUMN report_json TEXT" },
  { table: "drafts", column: "tags_json", ddl: "ALTER TABLE drafts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'" },
  { table: "drafts", column: "places_json", ddl: "ALTER TABLE drafts ADD COLUMN places_json TEXT NOT NULL DEFAULT '[]'" },
  { table: "images", column: "slot_index", ddl: "ALTER TABLE images ADD COLUMN slot_index INTEGER NOT NULL DEFAULT -1" },
];

function migrate(db: DB) {
  for (const m of MIGRATIONS) {
    if (!hasColumn(db, m.table, m.column)) db.exec(m.ddl);
  }
}

function open(): DB {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as SqliteModule;
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__naverBlogDb) globalForDb.__naverBlogDb = open();
  return globalForDb.__naverBlogDb;
}
