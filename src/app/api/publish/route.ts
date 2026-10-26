import { NextResponse } from "next/server";
import { z } from "zod";
import { publishDraftToNaver } from "@/server/publish/publishDraft";
import { jsonError } from "@/server/http";

const Body = z.object({
  draftId: z.string().min(1),
  // 기본은 항상 임시저장. 실제 "발행"은 사용자가 네이버 화면에서 확인 후 직접 누른다.
  mode: z.enum(["draft", "live"]).default("draft"),
  visibility: z.enum(["public", "neighbor", "mutualNeighbor", "private"]).optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const result = await publishDraftToNaver(body.draftId, { mode: body.mode, visibility: body.visibility });
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (e) {
    return jsonError(e);
  }
}
