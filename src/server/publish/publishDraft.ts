import "server-only";
import PQueue from "p-queue";
import { getDraft, updateDraft } from "../db/repositories/drafts";
import { listImagesForDraft } from "../db/repositories/images";
import { recordPublish } from "../db/repositories/publishedPosts";
import { getActiveBlogId } from "../db/repositories/settings";
import { publishToNaver, type PublishMode, type PublishResult, type Visibility } from "../naver/publisher";
import { htmlToBlocks } from "@/lib/textToHtml";
import { sectionCaptions } from "@/lib/sectionAssignment";
import { planImages } from "@/lib/imagePlan";

// 로그인 세션 하나를 여러 발행이 동시에 쓰면 충돌한다 → 전부 직렬화(동시성 1)
const g = globalThis as unknown as { __publishQueue?: PQueue };
const queue = (g.__publishQueue ??= new PQueue({ concurrency: 1 }));

export function publishQueueSize(): number {
  return queue.size + queue.pending;
}

/** 리뷰 페이지와 파이프라인 자동저장이 같은 코드를 쓴다 */
export async function publishDraftToNaver(
  draftId: string,
  opts: { mode?: PublishMode; visibility?: Visibility; onProgress?: (msg: string) => void } = {},
): Promise<PublishResult> {
  const mode = opts.mode ?? "draft";
  return (await queue.add(async (): Promise<PublishResult> => {
    const draft = getDraft(draftId);
    if (!draft) return { success: false, url: null, error: "초안을 찾을 수 없습니다." };
    const blogId = getActiveBlogId();
    if (!blogId) {
      const error = "활성 네이버 블로그 계정이 없습니다. 설정에서 로그인해주세요.";
      recordPublish(draftId, { success: false, error });
      return { success: false, url: null, error };
    }
    const blocks = htmlToBlocks(draft.bodyHtml);
    const headingCount = blocks.filter((b) => b.type === "heading").length;
    const images = listImagesForDraft(draftId).map((i) => ({ id: i.id, slotIndex: i.slot_index, sourceRef: i.source_ref, path: i.processed_path }));
    const plan = planImages(images, headingCount);
    const captions = sectionCaptions(blocks).map((c, i) => (plan.sectionMain[i] ? c : null));

    const result = await publishToNaver({
      blogId,
      title: draft.title,
      blocks,
      leadImagePath: plan.lead?.path ?? null,
      sectionImagePaths: plan.sectionMain.map((m) => m?.path ?? null),
      sectionExtraPaths: plan.sectionExtras.map((xs) => xs.map((x) => x.path)),
      sectionCaptions: captions,
      tags: draft.tags,
      places: draft.places,
      mode,
      visibility: opts.visibility,
      onProgress: opts.onProgress,
    });
    recordPublish(draftId, { success: result.success, url: result.url, error: result.error });
    if (result.success && mode === "live") updateDraft(draftId, { status: "published" });
    return result;
  }))!;
}
