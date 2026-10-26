import "server-only";
import fs from "node:fs";
import path from "node:path";
import { styleProfilePath } from "@/lib/paths";
import { scrapeRecentPosts } from "../naver/blogStyleScraper";
import { getLatestStyleProfileRow, saveStyleProfileRow } from "../db/repositories/styleProfiles";
import { buildPromptFragment, computeEndingStats, summarizeTone, type StyleProfile } from "./styleProfileBuilder";

export type StyleResult = {
  source: "fresh" | "saved" | "none";
  profile: StyleProfile | null;
  profileId: string | null;
  error: string | null;
};

export function loadSavedStyleProfile(blogId: string): { profile: StyleProfile; id: string } | null {
  const row = getLatestStyleProfileRow(blogId);
  const file = row?.profile_json_path ?? styleProfilePath(blogId);
  try {
    const profile = JSON.parse(fs.readFileSync(file, "utf-8")) as StyleProfile;
    return row ? { profile, id: row.id } : null;
  } catch {
    return null;
  }
}

/** 최근 3개 글 → 말투 프로필 생성/저장 */
export async function buildRecentPostsStyle(blogId: string, onProgress?: (msg: string) => void): Promise<StyleProfile> {
  onProgress?.("내 블로그 최근 글 읽는 중…");
  const posts = await scrapeRecentPosts(blogId, 3);
  if (!posts.length) throw new Error("내 블로그의 최근 글을 읽지 못했습니다(비공개 글이거나 네트워크 오류).");
  onProgress?.("말투 분석 중…");
  const endingStats = computeEndingStats(posts.map((p) => p.text));
  let toneSummary: string | null = null;
  try {
    toneSummary = await summarizeTone(posts);
  } catch (e) {
    console.warn("[style] 말투 요약 실패, 통계만 사용:", (e as Error).message);
  }
  const titles = posts.map((p) => p.title);
  const profile: StyleProfile = {
    blogId,
    builtAt: new Date().toISOString(),
    postsUsed: posts.length,
    titles,
    endingStats,
    toneSummary,
    promptFragment: buildPromptFragment(endingStats, toneSummary, titles),
  };
  const file = styleProfilePath(blogId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), "utf-8");
  saveStyleProfileRow(blogId, file, toneSummary?.slice(0, 500) ?? null);
  return profile;
}

/** 파이프라인용: 새로 분석 → 실패하면 마지막 저장본 → 그것도 없으면 null(기본 톤) */
export async function resolveStyleProfile(blogId: string | null, onProgress?: (msg: string) => void): Promise<StyleResult> {
  if (!blogId) return { source: "none", profile: null, profileId: null, error: "활성 블로그 ID가 설정되지 않았습니다." };
  try {
    const profile = await buildRecentPostsStyle(blogId, onProgress);
    const row = getLatestStyleProfileRow(blogId);
    return { source: "fresh", profile, profileId: row?.id ?? null, error: null };
  } catch (e) {
    const saved = loadSavedStyleProfile(blogId);
    if (saved) return { source: "saved", profile: saved.profile, profileId: saved.id, error: (e as Error).message };
    return { source: "none", profile: null, profileId: null, error: (e as Error).message };
  }
}
