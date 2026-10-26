import "server-only";
import { getPublicContext } from "../browser/playwrightManager";
import { extractJson, generateText, withTimeout } from "../ai/claudeClient";
import { scrapeBlogTabRanking } from "./searchScraper";
import { readNaverPost } from "./blogStyleScraper";
import type { RankPlaybook, RankedPostSummary } from "@/lib/reportTypes";

export type RankedPost = RankedPostSummary & {
  fullText: string;
  paragraphCount: number;
  medianParagraphLength: number;
  hasMap: boolean;
  titleKeywordCoverage: number;
  keywordCounts: Record<string, number>;
  intro: string;
  outro: string;
};

export type RankInsights = {
  keyword: string;
  posts: RankedPost[];
  avgCharCount: number;
  avgImageCount: number;
  avgTableCount: number;
  playbook: RankPlaybook | null;
  playbookError: string | null;
  /** draftPrompt에 그대로 넣는 요약 */
  summaryText: string;
};

const PLAYBOOK_TIMEOUT_MS = 150_000;
const MAX_CHAR_TARGET = 4500; // 상위 글 평균이 6000자+여도 그대로 목표로 삼으면 생성이 너무 오래 걸림
const MAX_TABLE_TARGET = 3;

export const KEYWORD_COUNT_RULE =
  "※ 관심 키워드와 상호명이 본문에 등장하는 횟수는 위 분석과 상관없이 각각 5~7번으로 고정입니다 (사용자가 정한 규칙이 항상 우선합니다).";

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

async function readPost(rank: number, url: string, listTitle: string, keyword: string, ctx: Awaited<ReturnType<typeof getPublicContext>>): Promise<RankedPost> {
  const post = await readNaverPost(url, ctx);
  const words = keyword.split(/\s+/).filter(Boolean);
  const title = post.title || listTitle;
  const lengths = post.paragraphs.map((p) => p.replace(/\s/g, "").length).filter((n) => n > 0);
  return {
    rank,
    url,
    title,
    fullText: post.fullText,
    charCount: post.fullText.replace(/\s/g, "").length,
    imageCount: post.imageCount,
    tableCount: post.tableCount,
    hasMap: post.hasMap,
    paragraphCount: lengths.length,
    medianParagraphLength: median(lengths),
    headings: post.headings.slice(0, 15),
    titleKeywordCoverage: words.length ? words.filter((w) => title.includes(w)).length / words.length : 0,
    keywordCounts: Object.fromEntries(words.map((w) => [w, countOccurrences(post.fullText, w)])),
    intro: post.fullText.slice(0, 300),
    outro: post.fullText.slice(-250),
  };
}

function buildPlaybookPrompt(keyword: string, posts: RankedPost[]): string {
  const lines = posts.map((p) =>
    [
      `### ${p.rank}위: ${p.title}`,
      `- 글자수(공백제외) ${p.charCount}, 이미지 ${p.imageCount}, 표 ${p.tableCount}, 지도 ${p.hasMap ? "있음" : "없음"}, 문단 ${p.paragraphCount}개(문단길이 중앙값 ${p.medianParagraphLength}자)`,
      `- 제목 키워드 포함률 ${Math.round(p.titleKeywordCoverage * 100)}%`,
      `- 소제목 후보: ${p.headings.join(" / ") || "(없음)"}`,
      `- 도입부: ${p.intro}`,
      `- 마무리: ${p.outro}`,
    ].join("\n"),
  );
  return `네이버 블로그 검색에서 "${keyword}" 키워드로 1~${posts.length}위에 노출된 글들의 실측 데이터입니다.
이 글들이 상위노출된 "방식"을 분석해 아래 JSON 하나만 출력하세요. 설명문은 쓰지 마세요.

${lines.join("\n\n")}

출력 JSON 형식:
{
  "titlePatterns": ["제목을 짓는 방식(예: 키워드 앞배치 + 지역 + 장점 나열)"],
  "titleLength": {"min": 숫자, "max": 숫자},
  "keywordPlacement": ["키워드를 넣는 위치와 방식"],
  "sectionFlow": ["도입", "...", "마무리"],
  "introHook": "도입부를 여는 방식",
  "closing": "마무리 방식",
  "recommended": {"charCount": 숫자, "imageCount": 숫자, "subheadingCount": 숫자, "tableCount": 숫자},
  "techniques": ["정보 전달 기법"],
  "mustCoverTopics": ["상위 글들이 공통으로 다루는 주제"],
  "toneNotes": "말투/분위기 특징"
}

중요: keywordPlacement에는 위치와 방식만 적고, 본문에 몇 번 반복하는지 횟수는 절대 적지 마세요.
문장이나 표현을 그대로 옮기지 말고 "방식"만 요약하세요.`;
}

function sanitizePlaybook(raw: Partial<RankPlaybook>, insights: { avgCharCount: number; avgImageCount: number; avgTableCount: number }): RankPlaybook {
  const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const rec = (raw.recommended ?? {}) as Partial<RankPlaybook["recommended"]>;
  return {
    titlePatterns: arr(raw.titlePatterns),
    titleLength: { min: num(raw.titleLength?.min, 15), max: num(raw.titleLength?.max, 32) },
    // 혹시 모델이 횟수를 끼워 넣었으면 그 항목은 제거(사용자 규칙 5~7번과 충돌)
    keywordPlacement: arr(raw.keywordPlacement).filter((s) => !/\d+\s*(?:~\s*\d+\s*)?(회|번)/.test(s)),
    sectionFlow: arr(raw.sectionFlow),
    introHook: String(raw.introHook ?? ""),
    closing: String(raw.closing ?? ""),
    recommended: {
      charCount: Math.min(MAX_CHAR_TARGET, Math.round(num(rec.charCount, insights.avgCharCount))),
      imageCount: Math.round(num(rec.imageCount, insights.avgImageCount)),
      subheadingCount: Math.round(num(rec.subheadingCount, 4)),
      tableCount: Math.min(MAX_TABLE_TARGET, Math.round(num(rec.tableCount, insights.avgTableCount))),
    },
    techniques: arr(raw.techniques),
    mustCoverTopics: arr(raw.mustCoverTopics),
    toneNotes: String(raw.toneNotes ?? ""),
  };
}

export function buildRankSummaryText(insights: Omit<RankInsights, "summaryText">): string {
  const p = insights.playbook;
  const lines: string[] = [
    `상위 ${insights.posts.length}개 글 평균: 글자수 ${Math.round(insights.avgCharCount)}자, 이미지 ${insights.avgImageCount.toFixed(1)}장, 표 ${insights.avgTableCount.toFixed(1)}개`,
    ...insights.posts.map((x) => `- ${x.rank}위 "${x.title}" (${x.charCount}자, 이미지 ${x.imageCount}, 소제목: ${x.headings.slice(0, 6).join(" / ") || "없음"})`),
  ];
  if (p) {
    lines.push(
      "",
      "[상위노출 공략법]",
      `- 제목 방식: ${p.titlePatterns.join(" / ")} (길이 ${p.titleLength.min}~${p.titleLength.max}자)`,
      `- 키워드 배치: ${p.keywordPlacement.join(" / ")}`,
      `- 글 뼈대: ${p.sectionFlow.join(" → ")}`,
      `- 도입 방식: ${p.introHook}`,
      `- 마무리 방식: ${p.closing}`,
      `- 권장 분량: 약 ${p.recommended.charCount}자, 이미지 ${p.recommended.imageCount}장, 소제목 ${p.recommended.subheadingCount}개, 표 ${p.recommended.tableCount}개`,
      `- 정보 기법: ${p.techniques.join(" / ")}`,
      `- 핵심 주제: ${p.mustCoverTopics.join(" / ")}`,
      `- 분위기: ${p.toneNotes}`,
    );
  }
  lines.push("", KEYWORD_COUNT_RULE);
  return lines.join("\n");
}

export async function analyzeTopRanked(keyword: string, onProgress?: (msg: string) => void): Promise<RankInsights> {
  onProgress?.("상위노출 1~5위 글 수집 중…");
  const ranking = await scrapeBlogTabRanking(keyword, 5);
  if (!ranking.length) throw new Error("블로그탭 검색 결과를 읽지 못했습니다.");
  const ctx = await getPublicContext();
  const posts: RankedPost[] = [];
  try {
    for (const r of ranking) {
      onProgress?.(`상위노출 ${r.rank}위 글 분석 중 (${r.rank}/${ranking.length})…`);
      try {
        posts.push(await readPost(r.rank, r.url, r.title, keyword, ctx));
      } catch (e) {
        console.warn("[rank] 글 읽기 실패:", r.url, (e as Error).message);
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!posts.length) throw new Error("상위노출 글 본문을 하나도 읽지 못했습니다.");

  const stats = {
    avgCharCount: avg(posts.map((p) => p.charCount)),
    avgImageCount: avg(posts.map((p) => p.imageCount)),
    avgTableCount: avg(posts.map((p) => p.tableCount)),
  };

  let playbook: RankPlaybook | null = null;
  let playbookError: string | null = null;
  onProgress?.("상위노출 공략법 정리 중…");
  try {
    // 공략법은 있으면 좋은 것이지 필수는 아니다 — 실패해도 파이프라인은 계속
    const text = await withTimeout(generateText(buildPlaybookPrompt(keyword, posts), { lightweight: true }), PLAYBOOK_TIMEOUT_MS, "상위노출 공략법 분석");
    playbook = sanitizePlaybook(extractJson<Partial<RankPlaybook>>(text), stats);
  } catch (e) {
    playbookError = (e as Error).message;
  }

  const base = { keyword, posts, ...stats, playbook, playbookError };
  return { ...base, summaryText: buildRankSummaryText(base) };
}
