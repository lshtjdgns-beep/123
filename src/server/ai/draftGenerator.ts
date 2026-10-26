import "server-only";
import { extractJson, generateText, withTimeout } from "./claudeClient";
import { buildDraftSystemPrompt, buildDraftUserPrompt, buildRewriteInstruction, titleMaxLength, type PromptPhoto } from "./prompts/draftPrompt";
import { maxOverlapAgainstSources } from "./similarity";
import {
  capEmphasisPerSection, evaluateChecks, filterPlaces, insertTableOfContents, normalizeTables, parseDraftOutput,
  type ParsedDraft,
} from "./draftChecks";
import { finalizeTags } from "../seo/tagGenerator";
import { blocksToVisibleText, stripMarkers, type ContentBlock } from "@/lib/textToHtml";
import { splitIntoSections } from "@/lib/sectionAssignment";
import { DEFAULT_TARGETS, type AnalysisReview, type DraftTargets, type RankPlaybook, type VerificationCheck, type VerificationRound } from "@/lib/reportTypes";
import type { RankInsights } from "../naver/rankAnalysis";
import type { StyleProfile } from "../style/styleProfileBuilder";
import type { PhotoAnalysis } from "../images/photoAnalysis";

const MAX_ROUNDS = 4; // 첫 생성 + 재작성 3번
const GENERATE_TIMEOUT_MS = 10 * 60_000;
const REVIEW_TIMEOUT_MS = 150_000;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function computeTargets(keyword: string, business: string | null, rank: RankInsights | null): DraftTargets {
  const maxTitleLength = titleMaxLength(keyword, business);
  if (!rank) return { ...DEFAULT_TARGETS, maxTitleLength };
  const rec = rank.playbook?.recommended;
  return {
    minBodyLength: clamp(Math.max(1300, rec?.charCount || Math.round(rank.avgCharCount)), 1300, 4500),
    minSubheadingCount: clamp(Math.max(4, rec?.subheadingCount || Math.round(rank.avgImageCount) - 1), 4, 8),
    minTableCount: clamp(Math.max(1, Math.round(rec?.tableCount ?? rank.avgTableCount)), 1, 3),
    maxTitleLength,
  };
}

export function buildFactCorpus(sources: { title: string; excerpt: string | null }[], photos: (PhotoAnalysis | null)[]): string {
  return [
    ...sources.map((s) => `${s.title} ${s.excerpt ?? ""}`),
    ...photos.filter(Boolean).map((p) => `${p!.description} ${(p!.extractedText ?? []).join(" ")}`),
  ].join("\n");
}

/** 숫자로 셀 수 없는 두 가지(상위노출 방식 반영, 말투 반영)를 AI로 1회 판정 */
async function reviewAgainstAnalysis(input: {
  title: string; blocks: ContentBlock[]; playbook: RankPlaybook | null; styleSummary: string | null;
}): Promise<{ review: AnalysisReview; issues: string[] }> {
  const sections = splitIntoSections(input.blocks);
  const paragraphs = input.blocks.filter((b) => b.type === "paragraph").map((b) => stripMarkers((b as { text: string }).text));
  const intro = blocksToVisibleText(sections[0].blocks).slice(0, 500);
  const middle = paragraphs.slice(Math.floor(paragraphs.length / 2) - 4, Math.floor(paragraphs.length / 2) + 4).join("\n");
  const outro = paragraphs.slice(-6).join("\n");
  const pb = input.playbook;
  const prompt = `블로그 초안이 아래 분석을 잘 반영했는지 판정하세요. 아래 JSON 하나만 출력하세요.

[초안]
제목: ${input.title}
소제목: ${sections.slice(1).map((s) => s.heading).join(" / ")}
도입부:
${intro}
본문 중간 발췌:
${middle}
마무리:
${outro}

${pb ? `[A) 상위노출 공략법]
제목 방식: ${pb.titlePatterns.join(" / ")}
키워드 배치: ${pb.keywordPlacement.join(" / ")}
글 뼈대: ${pb.sectionFlow.join(" → ")}
도입 방식: ${pb.introHook}
마무리 방식: ${pb.closing}
핵심 주제: ${pb.mustCoverTopics.join(" / ")}` : "[A) 상위노출 공략법] 없음 — structure는 null"}

${input.styleSummary ? `[B) 말투 분석]\n${input.styleSummary}` : "[B) 말투 분석] 없음 — tone은 null"}

판정 기준:
- 명백하게 어긋난 경우에만 fail 하세요. 취향 차이나 사소한 차이는 pass입니다.
- 글쓴이가 받은 자료에 없는 구체 정보(가격, 메뉴명, 영업시간, 주소 등)가 없다는 이유로 fail 하지 마세요. 그런 정보를 지어내라고 요구하는 fix도 절대 쓰지 마세요.
- fix에는 무엇을 어떻게 고칠지 한두 문장으로 구체적으로 쓰세요.

{"structure": {"pass": true, "reason": "...", "fix": ""} 또는 null, "tone": {"pass": true, "reason": "...", "fix": ""} 또는 null}`;
  const text = await withTimeout(generateText(prompt, { lightweight: true }), REVIEW_TIMEOUT_MS, "상위노출/말투 반영 검토");
  const raw = extractJson<AnalysisReview>(text);
  const norm = (x: AnalysisReview["structure"] | undefined) =>
    x && typeof x === "object" ? { pass: Boolean(x.pass), reason: String(x.reason ?? ""), fix: String(x.fix ?? "") } : null;
  const review: AnalysisReview = { structure: pb ? norm(raw.structure) : null, tone: input.styleSummary ? norm(raw.tone) : null };
  const issues: string[] = [];
  if (review.structure && !review.structure.pass) issues.push(`상위노출 방식 반영이 부족합니다: ${review.structure.reason} → ${review.structure.fix}`);
  if (review.tone && !review.tone.pass) issues.push(`내 블로그 말투 반영이 부족합니다: ${review.tone.reason} → ${review.tone.fix}`);
  return { review, issues };
}

/** 사진 속 텍스트(메뉴판 등)를 그 사진이 배정된 소제목 바로 아래에 사진텍스트 박스로 넣는다 */
function insertPhotoQuotes(blocks: ContentBlock[], photos: (PhotoAnalysis | null)[], photoSections: number[]): ContentBlock[] {
  const bySection = new Map<number, string[]>();
  photos.forEach((p, i) => {
    const s = photoSections[i] ?? -1;
    if (!p?.extractedText?.length || s < 0) return;
    bySection.set(s, [...(bySection.get(s) ?? []), p.extractedText.join("\n")]);
  });
  if (!bySection.size) return blocks;
  const out: ContentBlock[] = [];
  let h = -1;
  for (const b of blocks) {
    out.push(b);
    if (b.type === "heading") {
      h++;
      for (const text of bySection.get(h) ?? []) out.push({ type: "photoQuote", text });
    }
  }
  return out;
}

export type GenerateDraftInput = {
  keyword: string;
  businessName: string | null;
  sources: { type: string; title: string; excerpt: string | null }[];
  rank: RankInsights | null;
  style: StyleProfile | null;
  photos: (PhotoAnalysis | null)[];
  onProgress?: (msg: string) => void;
};

export type GeneratedDraft = {
  title: string;
  blocks: ContentBlock[];
  tags: string[];
  places: string[];
  /** 사진 i가 배정된 소제목 번호(0부터), 없으면 -1 */
  photoSections: number[];
  targets: DraftTargets;
  verification: { rounds: VerificationRound[]; allPassed: boolean; finalChecks: VerificationCheck[]; review: AnalysisReview | null };
};

export async function generateDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  const { keyword, businessName, rank, style, onProgress } = input;
  const targets = computeTargets(keyword, businessName, rank);
  const photos: PromptPhoto[] = input.photos
    .map((p, i) => (p ? { index: i + 1, description: p.description, suggestedSectionTopic: p.suggestedSectionTopic, extractedText: p.extractedText } : null))
    .filter((p): p is PromptPhoto => p !== null);
  const systemPrompt = buildDraftSystemPrompt({
    keyword, businessName, targets,
    hasStyleProfile: Boolean(style),
    hasPhotos: photos.length > 0,
    hasRankAnalysis: Boolean(rank),
  });
  const userPrompt = buildDraftUserPrompt({
    keyword, businessName, targets,
    sources: input.sources,
    rankSummary: rank?.summaryText ?? null,
    styleFragment: style?.promptFragment ?? null,
    photos,
  });
  const factCorpus = buildFactCorpus(input.sources, input.photos);
  const overlapSources = [...input.sources.map((s) => s.excerpt ?? ""), ...(rank?.posts.map((p) => p.fullText) ?? [])];

  const rounds: VerificationRound[] = [];
  let review: AnalysisReview | null = null;
  onProgress?.("초안 작성 중 (1/4라운드)…");
  let raw = await withTimeout(generateText(userPrompt, { systemPrompt }), GENERATE_TIMEOUT_MS, "초안 생성");
  let parsed: ParsedDraft = parseDraftOutput(raw, input.photos.length);
  let checks: VerificationCheck[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const bodyVisible = blocksToVisibleText(parsed.blocks, { includeToc: false });
    const overlap = maxOverlapAgainstSources(bodyVisible, overlapSources);
    checks = evaluateChecks({
      title: parsed.title, blocks: parsed.blocks, tags: parsed.tags, keyword, business: businessName, targets, overlap, factCorpus,
    });
    const issues = checks.filter((c) => !c.pass).map((c) => c.issue ?? `${c.label}: ${c.detail}`);

    // 측정 가능한 것들이 전부 통과했을 때만 추가로 AI 검토 1회(모델 호출 비용 때문에)
    if (issues.length === 0 && (rank?.playbook || style)) {
      onProgress?.(`상위노출 방식·말투 반영 검토 중 (${round}/4라운드)…`);
      try {
        const r = await reviewAgainstAnalysis({ title: parsed.title, blocks: parsed.blocks, playbook: rank?.playbook ?? null, styleSummary: style?.toneSummary ?? style?.promptFragment ?? null });
        review = r.review;
        issues.push(...r.issues);
      } catch (e) {
        console.warn("[draft] 반영 검토 실패(무시하고 진행):", (e as Error).message);
      }
    }

    rounds.push({ round, passed: issues.length === 0, issues, checks });
    if (issues.length === 0 || round === MAX_ROUNDS) break;

    onProgress?.(`요구사항 ${issues.length}개 미충족 → 재작성 중 (${round + 1}/4라운드)…`);
    const rewritePrompt = `${userPrompt}\n\n--- 방금 작성한 초안 ---\n${raw}\n\n${buildRewriteInstruction(issues)}`;
    raw = await withTimeout(generateText(rewritePrompt, { systemPrompt }), GENERATE_TIMEOUT_MS, "초안 재작성");
    const next = parseDraftOutput(raw, input.photos.length);
    // 재작성이 형식을 깨뜨렸으면(본문 비어 있음) 이전 초안 유지
    if (next.blocks.length && next.title) parsed = next;
  }

  // ---- safety net (모델이 규칙을 안 지켜도 최종 방어) ----
  let blocks = capEmphasisPerSection(parsed.blocks);
  blocks = normalizeTables(blocks);
  blocks = insertPhotoQuotes(blocks, input.photos, parsed.photoSections);
  blocks = insertTableOfContents(blocks);
  const tags = finalizeTags(parsed.tags, { title: parsed.title, keyword, businessName });
  const places = filterPlaces(parsed.places, businessName);

  // 최종 체크리스트는 실제로 저장/발행될 형태(목차·태그 보정 후) 기준으로 다시 계산
  const finalChecks = evaluateChecks({
    title: parsed.title, blocks, tags, keyword, business: businessName, targets,
    overlap: maxOverlapAgainstSources(blocksToVisibleText(blocks, { includeToc: false }), overlapSources),
    factCorpus,
  });
  checks = finalChecks;

  const last = rounds[rounds.length - 1];
  return {
    title: parsed.title,
    blocks,
    tags,
    places,
    photoSections: parsed.photoSections,
    targets,
    verification: { rounds, allPassed: Boolean(last?.passed) && finalChecks.every((c) => c.pass), finalChecks, review },
  };
}
