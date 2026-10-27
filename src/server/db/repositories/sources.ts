import "server-only";
import { nanoid } from "nanoid";
import { getDb } from "../client";

export type SourceRow = {
  id: string;
  keyword: string;
  type: "news" | "blog";
  title: string;
  url: string;
  excerpt: string | null;
  published_at: string | null;
  scraped_at: string;
  raw_json_path: string | null;
};

export type NewSource = { type: "news" | "blog"; title: string; url: string; excerpt?: string | null; publishedAt?: string | null; rawJsonPath?: string | null };

export function saveSources(keyword: string, items: NewSource[]): string[] {
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO sources (id, keyword, type, title, url, excerpt, published_at, raw_json_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const ids: string[] = [];
  db.exec("BEGIN");
  try {
    for (const it of items) {
      const id = nanoid(12);
      stmt.run(id, keyword, it.type, it.title, it.url, it.excerpt ?? null, it.publishedAt ?? null, it.rawJsonPath ?? null);
      ids.push(id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ids;
}

export function getSourcesByKeyword(keyword: string, limit = 40): SourceRow[] {
  return getDb().prepare("SELECT * FROM sources WHERE keyword = ? ORDER BY scraped_at DESC LIMIT ?").all(keyword, limit) as SourceRow[];
}

export function getSourcesByIds(ids: string[]): SourceRow[] {
  if (!ids.length) return [];
  const qs = ids.map(() => "?").join(",");
  return getDb().prepare(`SELECT * FROM sources WHERE id IN (${qs})`).all(...ids) as SourceRow[];
}
