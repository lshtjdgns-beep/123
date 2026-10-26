import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveBlogId, setActiveBlogId } from "@/server/db/repositories/settings";
import { listNaverAccounts } from "@/server/db/repositories/naverSessions";
import { jsonError } from "@/server/http";

export async function GET() {
  return NextResponse.json({
    blogId: getActiveBlogId(),
    accounts: listNaverAccounts().map((a) => ({ blogId: a.blog_id, lastValidatedAt: a.last_validated_at, valid: Boolean(a.valid), createdAt: a.created_at })),
    // 키 값 자체는 절대 내보내지 않고 보유 여부만
    apiKeys: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
      pixabay: Boolean(process.env.PIXABAY_API_KEY),
      anthropicApiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  });
}

const Put = z.object({ blogId: z.string().trim().regex(/^[\w-]+$/, "블로그 ID 형식이 아닙니다.") });

export async function PUT(req: Request) {
  try {
    const { blogId } = Put.parse(await req.json());
    setActiveBlogId(blogId);
    return NextResponse.json({ ok: true, blogId });
  } catch (e) {
    return jsonError(e);
  }
}
