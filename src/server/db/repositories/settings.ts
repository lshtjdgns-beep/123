import "server-only";
import { getDb } from "../client";

export function getSetting(key: string): string | null {
  const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** 현재 활성 블로그 ID: settings.blogId → .env의 NAVER_BLOG_ID */
export function getActiveBlogId(): string | null {
  return getSetting("blogId") || process.env.NAVER_BLOG_ID || null;
}

export function setActiveBlogId(blogId: string) {
  setSetting("blogId", blogId);
}
