// 생성 리포트(drafts.report_json) 타입. 서버/클라이언트 공용.

export type RankPlaybook = {
  titlePatterns: string[];
  titleLength: { min: number; max: number };
  /** 위치와 방식만. 반복 횟수는 절대 포함하지 않는다(사용자 규칙 5~7번과 충돌). */
  keywordPlacement: string[];
  /** "도입 → 매장정보 → 가격 → 후기 → 마무리" 식 순서 */
  sectionFlow: string[];
  introHook: string;
  closing: string;
  recommended: { charCount: number; imageCount: number; subheadingCount: number; tableCount: number };
  techniques: string[];
  mustCoverTopics: string[];
  toneNotes: string;
};

export type RankedPostSummary = {
  rank: number;
  title: string;
  url: string;
  charCount: number;
  imageCount: number;
  tableCount: number;
  headings: string[];
};

export type DraftTargets = {
  minBodyLength: number;
  minSubheadingCount: number;
  minTableCount: number;
  maxTitleLength: number;
};

export type VerificationCheck = { label: string; pass: boolean; detail: string; issue?: string };

export type VerificationRound = { round: number; passed: boolean; issues: string[]; checks: VerificationCheck[] };

export type AnalysisReview = {
  structure: { pass: boolean; reason: string; fix: string } | null;
  tone: { pass: boolean; reason: string; fix: string } | null;
};

export type DraftReport = {
  keyword: string;
  businessName: string | null;
  rankKeyword: string;
  rank: {
    keyword: string;
    avgCharCount: number;
    avgImageCount: number;
    avgTableCount: number;
    posts: RankedPostSummary[];
    playbook: RankPlaybook | null;
    playbookError?: string | null;
  } | null;
  rankError?: string | null;
  style: {
    source: "fresh" | "saved" | "none";
    postsUsed: number;
    titles: string[];
    toneSummary: string | null;
    endingStats: Record<string, number> | null;
    error?: string | null;
  } | null;
  /** corpus: 사진 설명+사진 속 텍스트(초안 화면 재검사 때 근거 자료로 다시 씀) */
  photos?: { count: number; analyzed: number; error: string | null; corpus?: string } | null;
  targets: DraftTargets;
  verification: {
    rounds: VerificationRound[];
    allPassed: boolean;
    finalChecks: VerificationCheck[];
    review?: AnalysisReview | null;
  };
  images?: { count: number; error: string | null } | null;
  autoSave: { attempted: boolean; success: boolean; error: string | null; warnings?: string[] } | null;
};

export const DEFAULT_TARGETS: DraftTargets = {
  minBodyLength: 1300,
  minSubheadingCount: 4,
  minTableCount: 1,
  maxTitleLength: 32,
};
