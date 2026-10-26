import "server-only";
import { nanoid } from "nanoid";
import { getDb } from "../client";

export type PublishedPostRow = {
  id: string;
  draft_id: string;
  naver_post_url: string | null;
  published_at: string;
  success: number;
  error_message: string | null;
};

export type HistoryItem = PublishedPostRow & { title: string; keyword: string; draft_status: string };

export function recordPublish(draftId: string, result: { success: boolean; url?: string | null; error?: string | null }): string {
  const id = nanoid(12);
  getDb().prepare("INSERT INTO published_posts (id, draft_id, naver_post_url, success, error_message) VALUES (?, ?, ?, ?, ?)")
    .run(id, draftId, result.url ?? null, result.success ? 1 : 0, result.error ?? null);
  return id;
}

export function listHistory(limit = 100): HistoryItem[] {
  return getDb().prepare(`SELECT p.*, d.title AS title, d.keyword AS keyword, d.status AS draft_status
    FROM published_posts p JOIN drafts d ON d.id = p.draft_id
    ORDER BY p.published_at DESC, p.rowid DESC LIMIT ?`).all(limit) as HistoryItem[];
}
