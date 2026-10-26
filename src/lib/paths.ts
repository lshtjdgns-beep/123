import path from "node:path";

// 모든 런타임 데이터는 data/ 아래에 둔다(전부 gitignore).
export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "app.db");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const STYLE_PROFILES_DIR = path.join(DATA_DIR, "style-profiles");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const UPLOADS_DIR = path.join(MEDIA_DIR, "uploads");
export const PROCESSED_DIR = path.join(MEDIA_DIR, "processed");
export const SOURCES_CACHE_DIR = path.join(DATA_DIR, "cache", "sources");
export const SUPERVISOR_LOG = path.join(DATA_DIR, "supervisor.log");

function safeBlogId(blogId: string): string {
  return blogId.replace(/[^\w-]/g, "_");
}

// 계정별 세션 파일. 단일 공유 파일을 쓰면 새 계정으로 로그인하는 순간
// 이전 계정 세션이 덮어써져 사라진다(실제 버그).
export function sessionStatePath(blogId: string): string {
  return path.join(SESSIONS_DIR, `naver-storage-state-${safeBlogId(blogId)}.json`);
}

// 로그인 직후 blogId를 아직 모를 때 쓰는 임시 파일
export const PENDING_SESSION_PATH = path.join(SESSIONS_DIR, "naver-storage-state-pending.json");

export function styleProfilePath(blogId: string): string {
  return path.join(STYLE_PROFILES_DIR, `${safeBlogId(blogId)}.json`);
}
