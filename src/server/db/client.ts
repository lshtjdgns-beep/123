import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "@/lib/paths";

type DB = Database.Database;

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
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__naverBlogDb) globalForDb.__naverBlogDb = open();
  return globalForDb.__naverBlogDb;
}
