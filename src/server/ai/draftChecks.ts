// 순수 함수 모음: 초안 파싱, 단일 체크리스트(evaluateChecks), 후처리 safety net.
// 생성 시 검증 루프 · 초안 화면의 seo-check API · 재작성 지시문이 전부 이 파일의
// evaluateChecks 하나를 쓴다(세 곳이 각자 다른 기준으로 검사하면 반드시 어긋난다).
//
// "server-only"를 붙이지 않은 이유: 테스트 스크립트(tsx)에서 직접 import하기 위해.
// 클라이언트 컴포넌트에서는 import하지 않는다.

import { plainTextToBlocks, stripMarkers, blocksToVisibleText, isLabelParagraph, type ContentBlock } from "@/lib/textToHtml";
import { splitIntoSections } from "@/lib/sectionAssignment";
import type { DraftTargets, VerificationCheck } from "@/lib/reportTypes";
import { isComposedOfTitleWords, normalizeTag } from "../seo/tagGenerator";

export const KEYWORD_MIN = 5;
export const KEYWORD_MAX = 7;
export const MAX_OVERLAP = 0.25;

// ---------------- 파싱 ----------------

export type ParsedDraft = {
  primaryKeyword: string;
  title: string;
  bodyText: string;
  blocks: ContentBlock[];
  tags: string[];
  places: string[];
  /** photoSections[사진번호-1] = 소제목 번호(0부터), 없으면 -1 */
  photoSections: number[];
};

function tag(text: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
  return m ? m[1].trim() : null;
}

export function parseDraftOutput(text: string, photoCount = 0): ParsedDraft {
  const title = stripMarkers(tag(text, "title") ?? "").replace(/\s+/g, " ").trim();
  const bodyText = tag(text, "body") ?? "";
  const split = (s: string | null) => (s ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const photoSections = Array.from({ length: photoCount }, () => -1);
  for (const pair of split(tag(text, "photo_sections"))) {
    const m = /(\d+)\s*:\s*(\d+)/.exec(pair);
    if (!m) continue;
    const p = Number(m[1]) - 1;
    const h = Number(m[2]) - 1;
    if (p >= 0 && p < photoCount && h >= 0) photoSections[p] = h;
  }
  return {
    primaryKeyword: tag(text, "primary_keyword") ?? "",
    title,
    bodyText,
    blocks: splitParagraphsBySentence(plainTextToBlocks(bodyText)),
    tags: split(tag(text, "tags")).map(normalizeTag).filter(Boolean),
    places: split(tag(text, "places")),
    photoSections,
  };
}

// ---------------- 카운트 유틸 ----------------

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 띄어쓰기 차이는 같은 것으로 본다("합정 맛집" = "합정맛집") */
export function countPhrase(text: string, phrase: string): number {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const re = new RegExp(words.map(escapeRe).join("\\s*"), "g");
  return stripMarkers(text).match(re)?.length ?? 0;
}

export const visibleCharCount = (s: string) => stripMarkers(s).replace(/\s/g, "").length;

/**
 * 본문 키워드/상호명 카운트용 텍스트. [[목차]] 블록도 포함해서 센다 — 목차는 생성
 * 시점엔 아직 없지만 실제 발행되는 글에는 들어간다. 목차 없이 세면 "체크리스트는
 * 통과"인데 실제 화면엔 8번 나오는 괴리가 생긴다(실제 버그). 아직 목차가 없으면
 * 소제목 텍스트를 한 번 더 넣어서 근사한다.
 */
export function countingText(blocks: ContentBlock[]): string {
  const base = blocksToVisibleText(blocks);
  const hasToc = blocks.some((b) => b.type === "toc");
  if (hasToc) return base;
  const headings = blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
  return `${base}\n${headings.join("\n")}`;
}

// ---------------- 지어내기 검사 ----------------

const FACT_PATTERNS = [
  /\d{1,3}(?:,\d{3})+\s*원|\d+\s*원/g, // 가격
  /\d{1,2}\s*:\s*\d{2}/g, // 시각
  /\d+\s*번\s*출구/g, // 출구 번호
];

const normFact = (s: string) => s.replace(/[\s,]/g, "");

/**
 * 프롬프트만 믿지 말고 기계적으로 잡는다. 본문(목차/사진텍스트 블록 제외 — 사진에서
 * 옮겨 적은 텍스트는 근거 자료지 검사 대상이 아님)에서 가격/시각/출구번호 패턴에
 * 매칭되는 토큰이 factCorpus에 없으면 "근거 없는 정보".
 */
export function findUnsupportedFacts(blocks: ContentBlock[], factCorpus: string): string[] {
  const corpus = normFact(factCorpus);
  const texts: string[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") texts.push(stripMarkers(b.text));
    else if (b.type === "table") texts.push(...b.rows.flat().map(stripMarkers));
  }
  const found = new Set<string>();
  for (const t of texts) {
    for (const re of FACT_PATTERNS) {
      for (const m of t.matchAll(re)) {
        const token = m[0].trim();
        if (!corpus.includes(normFact(token))) found.add(token);
      }
    }
  }
  return [...found];
}

// ---------------- 강조 규칙 ----------------

const BOLD_OR_UNDERLINE = /(\*\*|__)([\s\S]+?)\1/g;
const HIGHLIGHT = /==([\s\S]+?)==/g;

function emphasisCounts(blocks: ContentBlock[]) {
  let bu = 0;
  let hl = 0;
  for (const b of blocks) {
    if (b.type !== "paragraph" || isLabelParagraph(b.text)) continue;
    bu += b.text.match(BOLD_OR_UNDERLINE)?.length ?? 0;
    hl += b.text.match(HIGHLIGHT)?.length ?? 0;
  }
  return { bu, hl };
}

// ---------------- 체크리스트 ----------------

export type EvaluateInput = {
  title: string;
  blocks: ContentBlock[];
  tags: string[];
  keyword: string;
  business: string | null;
  targets: DraftTargets;
  overlap: number | null;
  factCorpus?: string | null;
};

export function evaluateChecks(input: EvaluateInput): VerificationCheck[] {
  const { title, blocks, tags, keyword, business, targets, overlap, factCorpus } = input;
  const checks: VerificationCheck[] = [];
  const add = (label: string, pass: boolean, detail: string, issue?: string) =>
    checks.push({ label, pass, detail, ...(pass ? {} : { issue }) });

  // 1. 제목 키워드 1번
  const tk = countPhrase(title, keyword);
  add("제목에 키워드 1번", tk === 1, `${tk}번`,
    tk === 0 ? `제목에 대표키워드 "${keyword}"가 없습니다. 제목에 정확히 1번 넣으세요.` : `제목에 대표키워드 "${keyword}"가 ${tk}번 들어갔습니다. 정확히 1번만 남기세요.`);

  // 2. 제목 상호명
  if (business) {
    const tb = countPhrase(title, business);
    add("제목에 상호명 포함", tb >= 1, tb ? "포함" : "없음", `제목에 상호명 "${business}"를 1번 넣으세요.`);
  } else add("제목에 상호명 포함", true, "상호명 없음(해당 없음)");

  // 3. 제목 길이
  const tl = [...title].length;
  add("제목 길이", tl > 0 && tl <= targets.maxTitleLength, `${tl}자 / 최대 ${targets.maxTitleLength}자`,
    `제목이 ${tl}자입니다. 키워드${business ? "와 상호명" : ""}은 유지하면서 ${targets.maxTitleLength}자 이내로 줄이세요.`);

  // 4. 본문 키워드 5~7번 (목차 포함 카운트)
  const ct = countingText(blocks);
  const bk = countPhrase(ct, keyword);
  add(`본문 키워드 ${KEYWORD_MIN}~${KEYWORD_MAX}번`, bk >= KEYWORD_MIN && bk <= KEYWORD_MAX, `${bk}번(목차 포함)`,
    bk < KEYWORD_MIN
      ? `본문에 대표키워드 "${keyword}"가 ${bk}번 들어갔습니다. ${KEYWORD_MIN}번 이상이 되도록 ${KEYWORD_MIN - bk}번 이상 더 넣으세요(키워드가 없는 소제목 섹션과 마무리에 자연스럽게).`
      : `본문에 대표키워드 "${keyword}"가 ${bk}번 들어갔습니다(소제목·목차 포함). ${KEYWORD_MAX}번 이하가 되도록 ${bk - KEYWORD_MAX}번 이상 줄이세요(같은 문단에 몰려 있는 곳부터 '이곳', '여기' 같은 표현으로 바꾸세요).`);

  // 5. 본문 상호명 5~7번
  if (business) {
    const bb = countPhrase(ct, business);
    add(`본문 상호명 ${KEYWORD_MIN}~${KEYWORD_MAX}번`, bb >= KEYWORD_MIN && bb <= KEYWORD_MAX, `${bb}번(목차 포함)`,
      bb < KEYWORD_MIN
        ? `본문에 상호명 "${business}"가 ${bb}번 들어갔습니다. ${KEYWORD_MIN}번 이상이 되도록 ${KEYWORD_MIN - bb}번 이상 더 넣으세요.`
        : `본문에 상호명이 ${bb}번 들어갔습니다. ${KEYWORD_MAX}번 이하가 되도록 ${bb - KEYWORD_MAX}번 이상 줄이세요(같은 문단에 몰려 있는 곳부터 '이곳', '여기' 같은 표현으로 바꾸세요).`);
  } else add(`본문 상호명 ${KEYWORD_MIN}~${KEYWORD_MAX}번`, true, "상호명 없음(해당 없음)");

  // 6~7. 태그
  const ntags = tags.map(normalizeTag);
  const kwTag = normalizeTag(keyword);
  add("태그에 키워드 포함", ntags.includes(kwTag), ntags.includes(kwTag) ? "포함" : "없음", `태그에 대표키워드 "${kwTag}"를 넣으세요(가급적 첫 태그).`);
  if (business) {
    const bt = normalizeTag(business);
    add("태그에 상호명 포함", ntags.includes(bt), ntags.includes(bt) ? "포함" : "없음", `태그에 상호명 "${bt}"를 넣으세요.`);
  } else add("태그에 상호명 포함", true, "상호명 없음(해당 없음)");

  // 8. 태그가 제목 단어로만 구성
  const keep = new Set([kwTag, business ? normalizeTag(business) : ""]);
  const strayTags = ntags.filter((t) => !keep.has(t) && !isComposedOfTitleWords(t, title));
  add("태그는 제목 단어 조합만", strayTags.length === 0, strayTags.length ? `제목에 없는 태그: ${strayTags.join(", ")}` : "통과",
    `태그 ${strayTags.join(", ")}는 제목에 없는 단어입니다. 제목에 실제로 쓰인 단어들의 조합으로만 태그를 만드세요.`);

  // 9. 글자수
  const chars = visibleCharCount(blocksToVisibleText(blocks, { includeToc: false }));
  add("본문 글자수", chars >= targets.minBodyLength, `${chars}자 / 최소 ${targets.minBodyLength}자(공백 제외)`,
    `본문이 공백 제외 ${chars}자입니다. ${targets.minBodyLength}자 이상이 되도록 늘리세요. 단, 자료에 없는 가격·시간 같은 구체 정보를 지어내지 말고 확인 방법 안내나 일반적인 팁으로 채우세요.`);

  // 10. 소제목
  const hc = blocks.filter((b) => b.type === "heading").length;
  add("소제목 개수", hc >= targets.minSubheadingCount, `${hc}개 / 최소 ${targets.minSubheadingCount}개`,
    `소제목이 ${hc}개입니다. [[H]]소제목[[/H]] 형식으로 ${targets.minSubheadingCount}개 이상이 되게 하세요.`);

  // 11. 표
  const tc = blocks.filter((b) => b.type === "table").length;
  add("표 개수", tc >= targets.minTableCount, `${tc}개 / 최소 ${targets.minTableCount}개`,
    `표가 ${tc}개입니다. [[TABLE]] 형식(3열×3행)으로 ${targets.minTableCount}개 이상 넣으세요. 자료에 없는 가격표 대신 체크리스트·비교·방문 팁 형태로 만드세요.`);

  // 12. 강조 규칙(하나로 합쳐서)
  const sections = splitIntoSections(blocks);
  const problems: string[] = [];
  const intro = emphasisCounts(sections[0].blocks);
  if (intro.bu + intro.hl > 0) problems.push("도입부에 강조가 있습니다(도입부는 강조 없이)");
  sections.slice(1).forEach((s, i) => {
    const c = emphasisCounts(s.blocks);
    const name = `${i + 1}번째 소제목 "${s.heading}"`;
    if (c.bu < 1 || c.bu > 2) problems.push(`${name} 섹션의 굵게/밑줄이 ${c.bu}번입니다(1~2번)`);
    if (c.hl !== 1) problems.push(`${name} 섹션의 노란 하이라이트가 ${c.hl}번입니다(정확히 1번)`);
  });
  add("강조 규칙", problems.length === 0, problems.length ? problems.join(" / ") : "통과",
    `강조 규칙을 고치세요: ${problems.join("; ")}. 각 소제목 섹션마다 **굵게** 또는 __밑줄__ 합쳐 1~2번(정보 라벨 줄 제외), ==하이라이트==는 그 섹션의 가장 중요한 짧은 구절 딱 1번, 도입부에는 강조 없음.`);

  // 13. 근거 없는 정보
  if (factCorpus != null) {
    const unsupported = findUnsupportedFacts(blocks, factCorpus);
    add("근거 없는 정보 없음", unsupported.length === 0, unsupported.length ? `자료에 없는 수치: ${unsupported.join(", ")}` : "통과",
      `본문의 ${unsupported.map((u) => `"${u}"`).join(", ")}는 주어진 자료(검색 자료·사진)에 없는 정보입니다. 지어낸 정보이므로 삭제하고, 대신 '방문 전에 네이버 지도나 전화로 확인해보세요'처럼 확인 방법을 안내하세요.`);
  }

  // 14. 원본 유사도
  if (overlap !== null) {
    add("원본과 유사도", overlap <= MAX_OVERLAP, `${Math.round(overlap * 100)}% / 최대 ${Math.round(MAX_OVERLAP * 100)}%`,
      `검색 자료·상위노출 글과 문장이 ${Math.round(overlap * 100)}% 겹칩니다. 같은 내용이라도 문장과 표현을 직접 바꿔 쓰세요.`);
  }
  return checks;
}

// ---------------- 후처리 safety net ----------------

const MARKED_SPAN = /(\*\*|__|==)[\s\S]+?\1/g;

/**
 * "한 줄 한 문장": 마침표/느낌표/물음표/물결/ㅎㅋㅠ 뒤에서 문단을 쪼갠다.
 *  - 숫자 앞의 물결("2~3개")은 범위 표현이므로 문장 끝으로 보지 않는다(~ 뒤 숫자면 안 자름).
 *  - 강조 마커 안쪽은 절대 쪼개지 않는다(마스킹 후 split, 복원).
 */
export function splitParagraphsBySentence(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type !== "paragraph") { out.push(b); continue; }
    const saved: string[] = [];
    // 강조 구간 안쪽이 문장부호로 끝나면("**맛있어요.**") 자리표시자 뒤에 \u0001을 붙여
    // 그 구간 뒤에서도 문장을 나눌 수 있게 한다.
    const masked = b.text.replace(MARKED_SPAN, (m) => {
      saved.push(m);
      const endsSentence = /([.!?。]|[ㅎㅋㅠ]{2,}|~)(\*\*|__|==)$/.test(m);
      return `\u0000${saved.length - 1}\u0000${endsSentence ? "\u0001" : ""}`;
    });
    const pieces = masked
      .split(/(?<=[.!?。\u0001]|[ㅎㅋㅠ]{2,})\s+|(?<=~)\s+(?!\d)/)
      .map((p) => p.replace(/\u0001/g, "").replace(/\u0000(\d+)\u0000/g, (_, i) => saved[Number(i)]).trim())
      .filter(Boolean);
    for (const p of pieces) out.push({ type: "paragraph", text: p });
  }
  return out;
}

/** 섹션당 굵게/밑줄이 2개, 하이라이트가 1개를 넘으면 초과분 마커만 벗겨낸다(하드 백스톱) */
export function capEmphasisPerSection(blocks: ContentBlock[], maxBu = 2, maxHl = 1): ContentBlock[] {
  let bu = 0;
  let hl = 0;
  return blocks.map((b) => {
    if (b.type === "heading") { bu = 0; hl = 0; return b; }
    if (b.type !== "paragraph" || isLabelParagraph(b.text)) return b;
    let text = b.text.replace(BOLD_OR_UNDERLINE, (m, _mk, inner) => (++bu > maxBu ? inner : m));
    text = text.replace(HIGHLIGHT, (m, inner) => (++hl > maxHl ? inner : m));
    return text === b.text ? b : { ...b, text };
  });
}

/** 소제목 목록으로 목차 블록을 코드로 직접 만든다(모델에게 맡기면 실제 소제목과 어긋날 수 있음) */
export function insertTableOfContents(blocks: ContentBlock[]): ContentBlock[] {
  const withoutToc = blocks.filter((b) => b.type !== "toc");
  const headings = withoutToc.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
  if (headings.length < 2) return withoutToc;
  const firstHeading = withoutToc.findIndex((b) => b.type === "heading");
  const toc: ContentBlock = { type: "toc", items: headings.map((h, i) => `${i + 1}. ${h}`) };
  return [...withoutToc.slice(0, firstHeading), toc, ...withoutToc.slice(firstHeading)];
}

/** 에디터 표는 3x3 고정 — 행/열을 3으로 맞춘다 */
export function normalizeTables(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((b) => {
    if (b.type !== "table") return b;
    const rows = b.rows.slice(0, 3).map((r) => {
      const cells = r.slice(0, 3);
      while (cells.length < 3) cells.push("");
      return cells;
    });
    while (rows.length < 3) rows.push(["", "", ""]);
    return { type: "table", rows };
  });
}

/** 교통 관련 지명 제외: 역/터미널/정류장으로 끝나면 상호명이 아닌 한 제거 */
export function filterPlaces(places: string[], businessName: string | null): string[] {
  const out: string[] = [];
  for (const p of places.map((x) => x.trim()).filter(Boolean)) {
    if (/(역|터미널|정류장)$/.test(p) && p !== businessName) continue;
    if (!out.includes(p)) out.push(p);
  }
  if (businessName && !out.includes(businessName)) out.unshift(businessName);
  return out.slice(0, 3);
}
