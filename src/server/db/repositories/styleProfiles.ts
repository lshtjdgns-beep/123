import "server-only";
import { nanoid } from "nanoid";
import { getDb } from "../client";

export type StyleProfileRow = {
  id: string;
  blog_id: string;
  profile_json_path: string;
  summary: string | null;
  built_at: string;
};

export function saveStyleProfileRow(blogId: string, profileJsonPath: string, summary: string | null): string {
  const id = nanoid(12);
  getDb().prepare("INSERT INTO style_profiles (id, blog_id, profile_json_path, summary) VALUES (?, ?, ?, ?)").run(id, blogId, profileJsonPath, summary);
  return id;
}

export function getLatestStyleProfileRow(blogId: string): StyleProfileRow | undefined {
  return getDb().prepare("SELECT * FROM style_profiles WHERE blog_id = ? ORDER BY built_at DESC, rowid DESC LIMIT 1").get(blogId) as StyleProfileRow | undefined;
}
