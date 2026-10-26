import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import { createRun, listRecentRuns } from "@/server/db/repositories/runs";
import { runPipeline } from "@/server/pipeline/runPipeline";
import { checkClaudeCredentialsLocal } from "@/server/ai/claudeClient";
import { UPLOADS_DIR } from "@/lib/paths";
import { jsonError } from "@/server/http";

const Body = z.object({
  keyword: z.string().trim().min(1, "키워드를 입력해주세요."),
  rankKeyword: z.string().trim().optional().nullable(),
  businessName: z.string().trim().optional().nullable(),
  /** photos/upload가 돌려준 파일 이름들 */
  photoPaths: z.array(z.string()).optional(),
  generateAiPhotos: z.boolean().optional(),
  generateCardImages: z.boolean().optional(),
  autoSaveDraft: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    // 로그인이 없으면 파이프라인을 시작하지도 않는다
    const cred = checkClaudeCredentialsLocal();
    if (!cred.ok) return NextResponse.json({ error: cred.message }, { status: 401 });
    // 업로드 폴더 밖 경로는 받지 않는다(파일 이름만 허용)
    const photoPaths = (body.photoPaths ?? []).map((n) => path.join(UPLOADS_DIR, path.basename(n)));
    const runId = createRun(body.keyword);
    void runPipeline(runId, { ...body, photoPaths }); // fire-and-forget
    return NextResponse.json({ runId });
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET() {
  return NextResponse.json({ runs: listRecentRuns(20) });
}
