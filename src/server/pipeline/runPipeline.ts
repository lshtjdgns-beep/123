import "server-only";
import { checkClaudeCredentialsLocal, ClaudeAuthError } from "../ai/claudeClient";
import { buildFactCorpus, generateDraft } from "../ai/draftGenerator";
import { collectSources } from "../naver/searchScraper";
import { analyzeTopRanked, type RankInsights } from "../naver/rankAnalysis";
import { resolveStyleProfile } from "../style/recentPostsStyle";
import { analyzePhotos, type PhotoAnalysis } from "../images/photoAnalysis";
import { sourceImagesForDraft } from "../images/imageSourcing";
import { publishDraftToNaver } from "../publish/publishDraft";
import { updateRun } from "../db/repositories/runs";
import { saveSources, getSourcesByKeyword, type NewSource } from "../db/repositories/sources";
import { createDraft, updateDraft } from "../db/repositories/drafts";
import { getActiveBlogId } from "../db/repositories/settings";
import { blocksToHtml } from "@/lib/textToHtml";
import type { DraftReport } from "@/lib/reportTypes";

export type PipelineInput = {
  keyword: string;
  rankKeyword?: string | null;
  businessName?: string | null;
  photoPaths?: string[];
  generateAiPhotos?: boolean;
  generateCardImages?: boolean;
  autoSaveDraft?: boolean;
};

/**
 * 전체 오케스트레이션. POST /api/run이 runId를 즉시 돌려주고 이 함수를 fire-and-forget으로 돌린다.
 * 각 단계 실패는 서로를 막지 않게 개별 try/catch로 감싸고, 결과는 전부 report_json에 기록한다.
 */
export async function runPipeline(runId: string, input: PipelineInput): Promise<void> {
  const keyword = input.keyword.trim();
  const businessName = input.businessName?.trim() || null;
  const rankKeyword = input.rankKeyword?.trim() || keyword;
  const photoPaths = input.photoPaths ?? [];
  const detail = (d: string) => updateRun(runId, { detail: d });

  try {
    // 1. Claude 로그인 즉시 확인 — 없으면 몇 분 기다리지 않고 바로 실패
    const cred = checkClaudeCredentialsLocal();
    if (!cred.ok) throw new ClaudeAuthError(cred.message);

    // 2. 검색 자료 수집
    updateRun(runId, { status: "collecting", detail: "네이버 뉴스/블로그 검색 중…" });
    let sources: NewSource[] = [];
    let sourceIds: string[] = [];
    try {
      sources = await collectSources(keyword);
      sourceIds = saveSources(keyword, sources);
    } catch (e) {
      console.warn("[pipeline] 검색 자료 수집 실패:", (e as Error).message);
      sources = getSourcesByKeyword(keyword).map((s) => ({ type: s.type, title: s.title, url: s.url, excerpt: s.excerpt }));
    }

    // 3. 상위노출 분석
    let rank: RankInsights | null = null;
    let rankError: string | null = null;
    try {
      rank = await analyzeTopRanked(rankKeyword, detail);
    } catch (e) {
      rankError = (e as Error).message;
    }

    // 4. 말투 분석
    const style = await resolveStyleProfile(getActiveBlogId(), detail);

    // 5. 사진 분석
    let photos: (PhotoAnalysis | null)[] = [];
    let photoError: string | null = null;
    if (photoPaths.length) {
      detail(`사진 분석 중 (0/${photoPaths.length})…`);
      try {
        const r = await analyzePhotos(photoPaths, (done, total) => detail(`사진 분석 중 (${done}/${total})…`));
        photos = r.results;
        photoError = r.error;
      } catch (e) {
        if (e instanceof ClaudeAuthError) throw e; // 나머지도 같은 원인으로 다 실패할 게 뻔함
        photoError = (e as Error).message;
        photos = photoPaths.map(() => null);
      }
    }

    // 6. 초안 생성 + 검증 루프
    updateRun(runId, { status: "generating", detail: "초안 작성 중…" });
    const draft = await generateDraft({
      keyword, businessName,
      sources: sources.map((s) => ({ type: s.type, title: s.title, excerpt: s.excerpt ?? null })),
      rank,
      style: style.profile,
      photos,
      onProgress: detail,
    });

    const report: DraftReport = {
      keyword, businessName, rankKeyword,
      rank: rank
        ? {
            keyword: rank.keyword,
            avgCharCount: Math.round(rank.avgCharCount),
            avgImageCount: Math.round(rank.avgImageCount * 10) / 10,
            avgTableCount: Math.round(rank.avgTableCount * 10) / 10,
            posts: rank.posts.map((p) => ({ rank: p.rank, title: p.title, url: p.url, charCount: p.charCount, imageCount: p.imageCount, tableCount: p.tableCount, headings: p.headings })),
            playbook: rank.playbook,
            playbookError: rank.playbookError,
          }
        : null,
      rankError,
      style: {
        source: style.source,
        postsUsed: style.profile?.postsUsed ?? 0,
        titles: style.profile?.titles ?? [],
        toneSummary: style.profile?.toneSummary ?? null,
        endingStats: style.profile ? { ...style.profile.endingStats } : null,
        error: style.error,
      },
      photos: photoPaths.length
        ? { count: photoPaths.length, analyzed: photos.filter(Boolean).length, error: photoError, corpus: buildFactCorpus([], photos) }
        : null,
      targets: draft.targets,
      verification: draft.verification,
      images: null,
      autoSave: null,
    };

    const draftId = createDraft({
      runId, keyword, title: draft.title, bodyHtml: blocksToHtml(draft.blocks),
      styleProfileId: style.profileId, sourceIds, tags: draft.tags, places: draft.places, businessName, report,
    });

    // 7. 이미지
    updateRun(runId, { status: "sourcing_images", detail: "이미지 준비 중…" });
    try {
      const headings = draft.blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
      const r = await sourceImagesForDraft({
        draftId, keyword, headings, photoPaths, photoSections: draft.photoSections,
        generateAiPhotos: input.generateAiPhotos ?? true,
        generateCardImages: input.generateCardImages ?? false,
        onProgress: detail,
      });
      report.images = { count: r.count, error: r.errors.length ? r.errors.join(" / ") : null };
    } catch (e) {
      report.images = { count: 0, error: (e as Error).message };
    }
    updateDraft(draftId, { report });

    // 8. 네이버 임시저장(기본 on)
    let saveMsg = "";
    if (input.autoSaveDraft ?? true) {
      detail("네이버 임시저장 중…");
      const r = await publishDraftToNaver(draftId, { mode: "draft", onProgress: detail }).catch((e) => ({ success: false, url: null, error: (e as Error).message }));
      report.autoSave = { attempted: true, success: r.success, error: r.error };
      updateDraft(draftId, { report });
      saveMsg = r.success ? " · 네이버 임시저장 완료" : ` · 네이버 임시저장 실패(${r.error})`;
    } else {
      report.autoSave = { attempted: false, success: false, error: null };
      updateDraft(draftId, { report });
    }

    // 9. 완료
    const failed = draft.verification.finalChecks.filter((c) => !c.pass).length;
    const verifyMsg = draft.verification.allPassed ? "요구사항 모두 충족" : `요구사항 ${failed}개 미충족(초안 화면에서 확인)`;
    updateRun(runId, { status: "ready", detail: `${verifyMsg}${saveMsg}`, finished: true });
  } catch (e) {
    updateRun(runId, { status: "failed", error: (e as Error).message, detail: null, finished: true });
  }
}
