import "server-only";
import type { DraftTargets } from "@/lib/reportTypes";

/**
 * 제목 길이 상한은 동적으로 계산한다. 키워드가 길면 32자로는 키워드+상호명을
 * 다 못 넣어서 검증이 영원히 실패하는 문제가 있었다.
 */
export function titleMaxLength(keyword: string, businessName?: string | null): number {
  return Math.max(32, keyword.length + (businessName?.length ?? 0) + 10);
}

export type PromptPhoto = { index: number; description: string; suggestedSectionTopic: string; extractedText: string[] | null };

export type DraftPromptInput = {
  keyword: string;
  businessName: string | null;
  targets: DraftTargets;
  sources: { type: string; title: string; excerpt: string | null }[];
  rankSummary: string | null;
  styleFragment: string | null;
  photos: PromptPhoto[];
};

const FABRICATION_RULE =
  "가격, 메뉴명, 영업시간, 휴무일, 주소, 출구 번호, 주차 대수, 좌석 수, 웨이팅 시간처럼 사실 확인이 가능한 구체 정보는 사용자 프롬프트에 실제로 주어진 자료(검색 자료, 사진 설명, 사진 속 텍스트)에 있는 것만 쓰세요. 자료에 없으면 그 정보는 쓰지 말고, 대신 '가격과 영업시간은 방문 전에 네이버 지도나 전화로 확인해보세요'처럼 확인 방법을 안내하세요. 상위노출 글들에 나온 수치나 다른 가게의 정보를 이 가게 정보처럼 옮기지 마세요. 직원과 나눈 대화, 몇 시에 방문했는지, 먹어본 맛의 세부 묘사처럼 확인할 수 없는 경험담을 구체적으로 꾸며 쓰지 마세요.";

export function buildDraftSystemPrompt(opts: {
  keyword: string;
  businessName: string | null;
  targets: DraftTargets;
  hasStyleProfile: boolean;
  hasPhotos: boolean;
  hasRankAnalysis: boolean;
}): string {
  const { keyword, businessName, targets } = opts;
  const rules: string[] = [];

  rules.push(
    `0. 대표키워드는 사용자가 입력한 관심 키워드 "${keyword}" 그대로입니다. 줄이거나 새 단어와 합치지 마세요(띄어쓰기 조정만 허용). <primary_keyword> 태그에도 이 값을 그대로 쓰세요.`,
  );
  rules.push(
    `1. 제목: 대표키워드 "${keyword}"를 정확히 1번${businessName ? `, 상호명 "${businessName}"도 정확히 1번` : ""} 넣으세요. 완전한 문장이 아니라 키워드 나열형으로 짓고, ${targets.maxTitleLength}자 이내로 쓰세요.`,
  );
  rules.push(
    `2. 본문 키워드 횟수: 대표키워드 "${keyword}"는 본문(소제목 포함)에 5~7번 들어가야 합니다(정확히 몇 번이 아니라 5~7번 범위). 도입부 첫 문단에 1번, 나머지는 소제목 섹션과 마무리에 고르게 분산하세요. 한 문단에 몰아넣지 마세요.`,
  );
  rules.push(`3. 소제목은 ${targets.minSubheadingCount}개 이상, 각각 한 줄에 [[H]]소제목[[/H]] 형식으로 쓰세요.`);
  rules.push("4. 도입부 첫 문장은 독자가 계속 읽고 싶어지는 후킹 문장으로 시작하세요.");
  rules.push(
    "5. 강조 규칙: 각 소제목 섹션마다 **굵게** 또는 __밑줄__ 강조를 합쳐서 1~2번, ==노란 하이라이트==를 정확히 1번 쓰세요. 노란 하이라이트는 그 섹션에서 독자가 꼭 기억해야 할 가장 중요한 짧은 구절(5~20자)에만 쓰고, 문장 전체나 여러 문장에 칠하지 마세요. 도입부(첫 소제목 전)에는 어떤 강조도 쓰지 마세요.",
    "5-1. 정보 라벨: 영업시간·브레이크타임·주차·예약·위치·가격·메뉴·웨이팅처럼 정보 항목을 안내할 때는 항목 이름만 한 줄에 굵게 쓰고(예: **주차**), 바로 다음 줄부터 내용을 쓰세요. 라벨 줄은 항목 이름만(2~8자) 쓰고 문장을 붙이지 마세요. 라벨 줄은 5번의 강조 횟수에 포함되지 않습니다.",
  );
  rules.push("6. 한 문장은 한 줄에 쓰세요. 한 줄에 여러 문장을 이어 쓰지 마세요(줄바꿈으로 문장을 나누세요).");
  rules.push(`7. 본문은 공백 제외 ${targets.minBodyLength}자 이상 쓰세요. 다만 자료가 부족하면 지어내서 늘리지 말고, 확인 방법 안내나 일반적인 팁으로 채우세요.`);
  rules.push(
    `8. 표는 ${targets.minTableCount}개 이상, [[TABLE]] 다음 줄부터 행마다 "칸 | 칸 | 칸" 형식으로 쓰고 [[/TABLE]]로 닫으세요. 표는 정확히 3열 × 3행(첫 행은 머리글)으로 만드세요. 표 내용에도 14번 규칙이 적용됩니다 — 자료에 없는 가격표는 만들지 말고, 체크리스트·비교·방문 팁처럼 사실을 지어내지 않는 형태로 만드세요.`,
  );
  rules.push(
    "9. <places>에는 이 글이 소개하는 실제 장소(상호명)만 쉼표로 나열하세요. '마포역 근처예요'처럼 단순 위치 설명으로 언급한 역·터미널·정류장 같은 교통 관련 지명은 넣지 마세요.",
  );
  rules.push(
    `10. 태그: 5~10개. 대표키워드를 반드시 포함하고(가급적 첫 태그), 모든 태그는 제목에 실제로 쓰인 단어들의 조합으로만 만드세요. 제목에 없는 새 단어(다른 지명, 다른 상호 등)는 태그에 쓰지 마세요.${businessName ? ` 상호명 "${businessName}"도 태그에 반드시 넣으세요.` : ""}`,
  );
  if (opts.hasPhotos) {
    rules.push(
      "11. 사진: 사용자 프롬프트의 사진마다 어울리는 소제목에 배치하고, <photo_sections>사진번호:소제목번호,사진번호:소제목번호</photo_sections> 형식(예: 1:1,2:3)으로 알려주세요. 사진 설명과 사진 속 텍스트에 없는 내용은 지어내지 마세요.",
    );
  }
  if (businessName) {
    rules.push(`12. 상호명 "${businessName}": 제목에 1번, 본문에 5~7번(키워드와 같은 범위), 태그에 반드시 포함.`);
  }
  if (opts.hasRankAnalysis) {
    rules.push(
      "13. 상위노출 분석: 사용자 프롬프트의 상위노출 공략법(제목 방식·글 뼈대·키워드 배치·도입/마무리 방식·권장 분량·정보 기법·핵심 주제)을 적용하되, 문장이나 표현은 베끼지 말고 방식만 따르세요. 키워드/상호명 횟수는 2번·12번 규칙이 항상 우선합니다.",
    );
  }
  rules.push(`14. (가장 중요) 지어내지 마세요. ${FABRICATION_RULE}`);

  const tone = opts.hasStyleProfile
    ? "말투: 사용자 프롬프트의 [내 블로그 말투 분석]을 최우선으로 따르세요. 종결어미·추임새·ㅎㅎ/물결 비율·문장 리듬을 그 분석에 맞추고, 분석에 없는 말버릇을 새로 만들지 마세요."
    : "말투: AI가 쓴 티가 나지 않게, 실제 블로거처럼 친근한 해요체로 쓰세요. ㅎㅎ, ㅋㅋ, ~ 같은 표현을 가끔 자연스럽게 섞으세요.";

  return `당신은 네이버 블로그 상위노출(SEO)에 능숙한 블로그 작가입니다.
아래 규칙을 번호 순서대로 반드시 지키세요. 규칙끼리 충돌하면 번호가 작은 규칙과 14번(지어내지 않기)이 우선합니다.

${rules.join("\n")}

${tone}

출력 형식(이 태그들만 출력, 다른 설명 금지):
<primary_keyword>${keyword}</primary_keyword>
<title>제목</title>
<body>
도입부 문장(한 줄에 한 문장)
[[H]]소제목[[/H]]
본문 문장…
[[TABLE]]
머리글 | 머리글 | 머리글
칸 | 칸 | 칸
칸 | 칸 | 칸
[[/TABLE]]
…
</body>
<tags>태그1,태그2,…</tags>
<places>장소1,장소2</places>${opts.hasPhotos ? "\n<photo_sections>1:1,2:2</photo_sections>" : ""}`;
}

export function buildDraftUserPrompt(input: DraftPromptInput): string {
  const parts: string[] = [];
  parts.push(`관심 키워드(대표키워드): ${input.keyword}`);
  if (input.businessName) parts.push(`홍보할 상호명: ${input.businessName}`);

  const src = input.sources.slice(0, 15);
  parts.push(
    "",
    "[검색 자료] — 사실 정보는 여기와 사진 자료에 있는 것만 쓸 수 있습니다.",
    src.length ? src.map((s, i) => `${i + 1}. (${s.type === "news" ? "뉴스" : "블로그"}) ${s.title}\n   ${(s.excerpt ?? "").slice(0, 300)}`).join("\n") : "(검색 자료 없음 — 구체 정보는 쓰지 말고 확인 방법을 안내하세요)",
  );

  if (input.photos.length) {
    parts.push(
      "",
      "[첨부 사진]",
      input.photos
        .map(
          (p) =>
            `사진 ${p.index}: ${p.description}${p.suggestedSectionTopic ? ` (어울리는 주제: ${p.suggestedSectionTopic})` : ""}${
              p.extractedText?.length ? `\n   사진 속 텍스트:\n   ${p.extractedText.join("\n   ")}` : ""
            }`,
        )
        .join("\n"),
    );
  }

  if (input.rankSummary) parts.push("", "[상위노출 분석]", input.rankSummary);
  if (input.styleFragment) parts.push("", input.styleFragment);

  parts.push("", `목표: 공백 제외 ${input.targets.minBodyLength}자 이상, 소제목 ${input.targets.minSubheadingCount}개 이상, 표 ${input.targets.minTableCount}개 이상, 제목 ${input.targets.maxTitleLength}자 이내.`);
  parts.push("시스템 프롬프트의 출력 형식대로만 작성하세요.");
  return parts.join("\n");
}

export function buildRewriteInstruction(issues: string[]): string {
  return [
    "--- 수정 요청 ---",
    "방금 작성한 초안에서 아래 항목이 요구사항을 충족하지 못했습니다. 고쳐서 전체 글을 같은 출력 형식으로 다시 작성하세요.",
    ...issues.map((s, i) => `${i + 1}. ${s}`),
    "",
    // 이 줄이 없으면 한 항목을 고치다가 이미 통과한 다른 항목을 깨뜨리는 왕복이 발생한다
    "위 항목 중 이미 통과한 조건(키워드·상호명 횟수, 강조 규칙, 말투, 글의 뼈대 등)은 수정하다가 깨지지 않게 그대로 유지하고, 지적된 항목만 고치세요.",
    "자료에 없는 가격·영업시간 같은 구체 정보를 새로 지어내서 채우지 마세요.",
  ].join("\n");
}
