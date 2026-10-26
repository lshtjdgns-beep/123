import { NextResponse } from "next/server";
import { suggestKeywords } from "@/server/seo/keywordSuggest";
import { jsonError } from "@/server/http";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ suggestions: [] });
  try {
    return NextResponse.json({ suggestions: await suggestKeywords(q) });
  } catch (e) {
    return jsonError(e, 502);
  }
}
