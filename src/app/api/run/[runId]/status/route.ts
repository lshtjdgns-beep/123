import { NextResponse } from "next/server";
import { getRun } from "@/server/db/repositories/runs";
import { getDraftByRun } from "@/server/db/repositories/drafts";

export async function GET(_req: Request, ctx: RouteContext<"/api/run/[runId]/status">) {
  const { runId } = await ctx.params;
  const run = getRun(runId);
  if (!run) return NextResponse.json({ error: "실행을 찾을 수 없습니다." }, { status: 404 });
  const draft = getDraftByRun(runId);
  return NextResponse.json({
    status: run.status,
    detail: run.detail,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    draftId: draft?.id ?? null,
  });
}
