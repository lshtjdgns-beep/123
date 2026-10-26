import { NextResponse } from "next/server";
import { getActiveBlogId } from "@/server/db/repositories/settings";
import { buildRecentPostsStyle, loadSavedStyleProfile } from "@/server/style/recentPostsStyle";
import { jsonError } from "@/server/http";

export async function GET() {
  const blogId = getActiveBlogId();
  if (!blogId) return NextResponse.json({ profile: null });
  return NextResponse.json({ profile: loadSavedStyleProfile(blogId)?.profile ?? null });
}

/** 즉시 재분석 */
export async function POST() {
  try {
    const blogId = getActiveBlogId();
    if (!blogId) return NextResponse.json({ error: "활성 블로그 ID가 없습니다." }, { status: 400 });
    return NextResponse.json({ profile: await buildRecentPostsStyle(blogId) });
  } catch (e) {
    return jsonError(e);
  }
}
