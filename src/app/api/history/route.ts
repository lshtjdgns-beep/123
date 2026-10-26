import { NextResponse } from "next/server";
import { listHistory } from "@/server/db/repositories/publishedPosts";
import { listDrafts } from "@/server/db/repositories/drafts";

export async function GET() {
  return NextResponse.json({
    history: listHistory(100),
    drafts: listDrafts(50).map((d) => ({ id: d.id, title: d.title, keyword: d.keyword, status: d.status, createdAt: d.createdAt, allPassed: d.report?.verification.allPassed ?? null })),
  });
}
