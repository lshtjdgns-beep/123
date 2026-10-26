import { NextResponse } from "next/server";
import { getDraft } from "@/server/db/repositories/drafts";
import { getSourcesByKeyword } from "@/server/db/repositories/sources";
import { evaluateChecks } from "@/server/ai/draftChecks";
import { htmlToBlocks } from "@/lib/textToHtml";
import { DEFAULT_TARGETS, type VerificationCheck } from "@/lib/reportTypes";
import { titleMaxLength } from "@/server/ai/prompts/draftPrompt";

/**
 * 사용자가 수동으로 고친 이후의 최신 상태를 생성 때와 같은 evaluateChecks로 재검사.
 * "상위노출 방식 반영"/"말투 반영"은 재계산이 비싸므로 생성 시점 결과를 그대로 보여준다.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/draft/[draftId]/seo-check">) {
  const { draftId } = await ctx.params;
  const draft = getDraft(draftId);
  if (!draft) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
  const targets = draft.report?.targets ?? { ...DEFAULT_TARGETS, maxTitleLength: titleMaxLength(draft.keyword, draft.businessName) };
  const sources = getSourcesByKeyword(draft.keyword);
  const factCorpus = [...sources.map((s) => `${s.title} ${s.excerpt ?? ""}`), draft.report?.photos?.corpus ?? ""].join("\n");
  const checks: VerificationCheck[] = evaluateChecks({
    title: draft.title,
    blocks: htmlToBlocks(draft.bodyHtml),
    tags: draft.tags,
    keyword: draft.keyword,
    business: draft.businessName,
    targets,
    overlap: null, // 원본 전문은 저장하지 않으므로 재검사에서는 생략
    factCorpus,
  });
  const review = draft.report?.verification.review;
  if (review?.structure) checks.push({ label: "상위노출 방식 반영 (생성 시 검증)", pass: review.structure.pass, detail: review.structure.reason });
  if (review?.tone) checks.push({ label: "말투 반영 (생성 시 검증)", pass: review.tone.pass, detail: review.tone.reason });
  return NextResponse.json({ checks, targets });
}
