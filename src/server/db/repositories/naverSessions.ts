import "server-only";
import { getDb } from "../client";

export type NaverSessionRow = {
  id: number;
  blog_id: string;
  storage_state_path: string;
  created_at: string;
  last_validated_at: string | null;
  valid: number;
};

export function recordNaverSession(blogId: string, storageStatePath: string) {
  getDb().prepare("INSERT INTO naver_sessions (blog_id, storage_state_path, last_validated_at, valid) VALUES (?, ?, datetime('now'), 1)")
    .run(blogId, storageStatePath);
}

export function markSessionValidated(blogId: string, valid: boolean) {
  getDb().prepare(`UPDATE naver_sessions SET valid = ?, last_validated_at = datetime('now')
    WHERE id = (SELECT MAX(id) FROM naver_sessions WHERE blog_id = ?)`).run(valid ? 1 : 0, blogId);
}

// blogId별 최신 row만. SQLite에서 GROUP BY로 얻은 non-key 컬럼은 어느 행 것인지
// 보장되지 않으므로 MAX(id) 서브쿼리로 명시한다.
export function listNaverAccounts(): NaverSessionRow[] {
  return getDb().prepare(`SELECT * FROM naver_sessions
    WHERE id IN (SELECT MAX(id) FROM naver_sessions GROUP BY blog_id)
    ORDER BY id DESC`).all() as NaverSessionRow[];
}
