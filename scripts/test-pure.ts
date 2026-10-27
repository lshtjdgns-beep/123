// 순수 함수 회귀 테스트. 실행: npm test
// (server-only 모듈도 import할 수 있게 --conditions=react-server 로 실행된다)
//
// 줄바꿈(10절)은 문서 예시 + 무작위 문단 수천 개에 대해 세 가지 불변식을 검사한다:
//  (a) 15자 초과 줄 없음 (b) 줄마다 마커 균형 (c) 원문과 공백만 다르고 글자는 동일
// 저장된 초안 DB(data/app.db)가 있으면 그 문단 전부에도 같은 검사를 돌린다.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { wrapIntoCenteredLines, visibleLength, MAX_LINE } from "../src/lib/centeredLineWrap";
import { blocksToHtml, htmlToBlocks, plainTextToBlocks, blocksToPlainText, type ContentBlock } from "../src/lib/textToHtml";
import {
  splitParagraphsBySentence, findUnsupportedFacts, evaluateChecks, capEmphasisPerSection, insertTableOfContents,
  filterPlaces, countPhrase, parseDraftOutput,
} from "../src/server/ai/draftChecks";
import { finalizeTags, isComposedOfTitleWords } from "../src/server/seo/tagGenerator";
import { computeEndingStats } from "../src/server/style/styleProfileBuilder";
import { parseAnalysis } from "../src/server/images/photoAnalysis";
import { planImages } from "../src/lib/imagePlan";
import { pickPostLinks, cleanLinkText } from "../src/server/naver/searchScraper";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`✘ ${name}\n   ${(e as Error).message.split("\n").join("\n   ")}`);
  }
}

// ---------------------------------------------------------------- 줄바꿈 불변식

const stripAll = (s: string) => s.replace(/\*\*|__|==/g, "").replace(/\s+/g, "");

function checkWrapInvariants(text: string): string | null {
  const lines = wrapIntoCenteredLines(text);
  for (const l of lines) {
    if (visibleLength(l) > MAX_LINE) return `15자 초과: "${l}" (${visibleLength(l)}자)`;
    for (const m of ["**", "__", "=="]) {
      const n = l.split(m).length - 1;
      if (n % 2) return `마커 불균형(${m}): "${l}"`;
    }
  }
  if (stripAll(lines.join("")) !== stripAll(text)) return `글자 유실/중복:\n  원문 ${stripAll(text)}\n  결과 ${stripAll(lines.join(""))}`;
  return null;
}

test("줄바꿈: 마커에 붙은 글자는 같은 단어(공백 생성·단어 중간 줄바꿈 없음)", () => {
  const lines = wrapIntoCenteredLines("**웨이팅 없이 자리 안내받아서 여유 있게 먹을 수 있었**던 게 좋았어요.");
  assert.ok(lines.some((l) => l.includes("있었**던")), lines.join(" | "));
  assert.ok(!lines.some((l) => l.endsWith("있었**")), lines.join(" | "));
  const l2 = wrapIntoCenteredLines("저녁 **7시**였는데도 자리가 있었어요.");
  assert.ok(l2.join(" ").includes("**7시**였는데도"), l2.join(" | "));
});

test("줄바꿈: 쉼표에서 여유가 있어도 줄을 바꾼다", () => {
  const lines = wrapIntoCenteredLines("주차가 어려운 부분이라, 차로 오시면 불편해요.");
  assert.equal(lines[0], "주차가 어려운 부분이라,");
});

test("줄바꿈: 긴 강조구도 단어 단위로 끊고 줄마다 마커를 다시 씌운다", () => {
  const lines = wrapIntoCenteredLines("**감으로 제목 정하면 거의 100% 묻힌다**는 말이 있죠.");
  assert.ok(lines.every((l) => !/(^|\s)00%|1\*\*$/.test(l)), lines.join(" | "));
  assert.ok(lines.join(" ").includes("100%"), lines.join(" | "));
  assert.ok(lines.filter((l) => l.includes("**")).every((l) => (l.split("**").length - 1) % 2 === 0));
});

test("줄바꿈: 15자 넘는 단어 하나만 글자 단위로 자른다", () => {
  const word = "가".repeat(20);
  const lines = wrapIntoCenteredLines(`${word} 끝`);
  assert.equal(lines[0], "가".repeat(15));
});

test("줄바꿈: visibleLength는 마커를 세지 않는다", () => {
  assert.equal(visibleLength("**굵게**와 ==노랑=="), 6);
});

test("줄바꿈: 무작위 문단 5000개 불변식", () => {
  const words = ["오늘은", "합정", "맛집", "다녀왔어요", "정말", "맛있었는데요,", "100%", "추천", "드려요~", "ㅎㅎ", "웨이팅", "없이", "바로", "들어갔어요.", "2~3개씩", "주문했어요!", "가나다라마바사아자차카타파하가나", "분위기가", "좋아서", "또", "올게요?"];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let n = 0; n < 5000; n++) {
    const len = 1 + Math.floor(rnd() * 14);
    const toks: string[] = [];
    for (let i = 0; i < len; i++) toks.push(words[Math.floor(rnd() * words.length)]);
    // 무작위 구간에 강조 마커(공백 없이 붙은 경우 포함)
    if (len > 2 && rnd() < 0.6) {
      const m = ["**", "__", "=="][Math.floor(rnd() * 3)];
      const a = Math.floor(rnd() * len);
      const b = Math.min(len - 1, a + Math.floor(rnd() * 4));
      toks[a] = m + toks[a];
      toks[b] = rnd() < 0.5 ? toks[b] + m : toks[b].slice(0, Math.max(1, toks[b].length - 1)) + m + toks[b].slice(Math.max(1, toks[b].length - 1));
    }
    const text = toks.join(" ");
    const err = checkWrapInvariants(text);
    if (err) throw new Error(`${err}\n  입력: ${text}`);
  }
});

test("줄바꿈: 저장된 초안 문단 전체 불변식(있으면)", () => {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  if (!fs.existsSync(dbPath)) return;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT body_html FROM drafts").all() as { body_html: string }[];
  let paragraphs = 0;
  for (const r of rows) {
    for (const b of htmlToBlocks(r.body_html)) {
      if (b.type !== "paragraph") continue;
      paragraphs++;
      const err = checkWrapInvariants(b.text);
      if (err) throw new Error(err);
    }
  }
  console.log(`   (저장된 초안 ${rows.length}개, 문단 ${paragraphs}개 검사)`);
});

// ---------------------------------------------------------------- 문장 분리

test("문장 분리: 숫자 앞 물결(2~3개)은 문장 끝이 아니다, ㅎㅎ 뒤는 자른다", () => {
  const out = splitParagraphsBySentence([{ type: "paragraph", text: "2~3개씩 시키면 좋아요 ㅎㅎ 양이 많거든요~ 다음엔 또 올게요." }]);
  assert.deepEqual(out.map((b) => (b as { text: string }).text), ["2~3개씩 시키면 좋아요 ㅎㅎ", "양이 많거든요~", "다음엔 또 올게요."]);
});

test("문장 분리: 강조 마커 안쪽은 쪼개지 않는다", () => {
  const out = splitParagraphsBySentence([{ type: "paragraph", text: "**맛있어요. 정말로요.** 추천해요." }]);
  assert.deepEqual(out.map((b) => (b as { text: string }).text), ["**맛있어요. 정말로요.**", "추천해요."]);
});

// ---------------------------------------------------------------- 지어내기 검사

test("근거 없는 정보: 자료에 없는 가격/시각/출구만 잡는다", () => {
  const blocks: ContentBlock[] = [
    { type: "paragraph", text: "아메리카노는 4,500원이고 브레이크타임은 15:00부터예요." },
    { type: "paragraph", text: "합정역 7번 출구에서 가까워요. 런치는 17,000원!" },
    { type: "photoQuote", text: "**세트메뉴**\n파스타 - 99,000원" },
  ];
  const corpus = "메뉴 아메리카노 4500원 / 합정역 7번출구";
  const found = findUnsupportedFacts(blocks, corpus);
  assert.deepEqual(found.sort(), ["15:00", "17,000원"].sort());
});

// ---------------------------------------------------------------- 체크리스트

const sampleBody = `합정 맛집을 찾고 계셨다면 오늘 글이 도움이 될 거예요.
[[H]]합정 맛집 분위기[[/H]]
**분위기**가 좋아요.
==조용한== 편이에요.
합정 맛집 중에서도 손꼽혀요.
[[H]]메뉴 고르는 팁[[/H]]
__두 명이면__ 세트가 좋아요.
==양이 넉넉==해요.
합정 맛집 찾는다면 기억해두세요.
[[TABLE]]
항목 | 팁 | 비고
주차 | 확인 필요 | 전화 문의
예약 | 권장 | 주말
[[/TABLE]]`;

test("체크리스트: 키워드 횟수에 목차 근사(소제목 1회 추가)가 포함된다", () => {
  const blocks = plainTextToBlocks(sampleBody);
  // 본문 3번 + 소제목 1번 + 목차 근사 1번 = 5
  const checks = evaluateChecks({
    title: "합정 맛집 분위기 메뉴 팁", blocks, tags: ["합정맛집", "합정"], keyword: "합정 맛집", business: null,
    targets: { minBodyLength: 50, minSubheadingCount: 2, minTableCount: 1, maxTitleLength: 32 }, overlap: null, factCorpus: "",
  });
  const kw = checks.find((c) => c.label.startsWith("본문 키워드"))!;
  assert.equal(kw.detail, "5번(목차 포함)");
  assert.ok(kw.pass);
  const emph = checks.find((c) => c.label === "강조 규칙")!;
  assert.ok(emph.pass, emph.detail);
  // 실제 목차를 넣은 뒤에도 같은 숫자가 나와야 한다
  const withToc = insertTableOfContents(blocks);
  assert.equal(countPhrase(withToc.map((b) => ("text" in b ? b.text : "items" in b ? b.items.join("\n") : "")).join("\n"), "합정 맛집"), 5);
});

test("체크리스트: 실패 항목은 구체적인 재작성 지시문을 돌려준다", () => {
  const checks = evaluateChecks({
    title: "합정 맛집 합정 맛집", blocks: plainTextToBlocks("**도입 강조**는 금지예요."), tags: ["어반플랜트합정"], keyword: "합정 맛집", business: "어반플랜트",
    targets: { minBodyLength: 1300, minSubheadingCount: 4, minTableCount: 1, maxTitleLength: 32 }, overlap: 0.5, factCorpus: "",
  });
  const failed = checks.filter((c) => !c.pass);
  assert.ok(failed.length >= 8, failed.map((c) => c.label).join(", "));
  assert.ok(failed.every((c) => c.issue && c.issue.length > 10));
  assert.ok(checks.find((c) => c.label === "강조 규칙")!.detail.includes("도입부"));
});

test("강조 백스톱: 섹션당 굵게/밑줄 2개, 하이라이트 1개 초과분만 벗긴다", () => {
  const out = capEmphasisPerSection(plainTextToBlocks("[[H]]a[[/H]]\n**1** __2__ **3** ==x== ==y=="));
  assert.equal((out[1] as { text: string }).text, "**1** __2__ 3 ==x== y");
});

// ---------------------------------------------------------------- 태그/장소

test("태그: 제목 단어 조합만, 키워드·상호명은 맨 앞에 강제", () => {
  const tags = finalizeTags(["합정맛집", "어반플랜트합정", "망원맛집", "합정데이트"], { title: "합정 맛집 데이트 코스 추천", keyword: "합정 맛집", businessName: "어반플랜트" });
  assert.deepEqual(tags, ["합정맛집", "어반플랜트", "합정데이트"]);
  assert.ok(isComposedOfTitleWords("맛집", "합정 맛집에서 데이트"));
});

test("장소: 역/터미널/정류장 제외, 상호명 포함", () => {
  assert.deepEqual(filterPlaces(["마포역", "합정 버스터미널", "어반플랜트 합정"], "어반플랜트 합정"), ["어반플랜트 합정"]);
});

// ---------------------------------------------------------------- 변환/파싱

test("HTML 왕복: 블록 → HTML → 블록이 같다", () => {
  const blocks = insertTableOfContents(plainTextToBlocks(sampleBody + "\n[[사진텍스트]]\n**세트**\n파스타 - 1원\n[[/사진텍스트]]"));
  assert.deepEqual(htmlToBlocks(blocksToHtml(blocks)), blocks);
  assert.deepEqual(plainTextToBlocks(blocksToPlainText(blocks)), blocks);
});

test("모델 출력 파싱: 태그·photo_sections", () => {
  const p = parseDraftOutput("<primary_keyword>합정 맛집</primary_keyword><title>합정 맛집 **추천**</title><body>\n안녕하세요. 반가워요.\n[[H]]소제목[[/H]]\n</body><tags>#합정맛집, 합정</tags><places>a,b</places><photo_sections>1:1,2:3</photo_sections>", 2);
  assert.equal(p.title, "합정 맛집 추천");
  assert.deepEqual(p.tags, ["합정맛집", "합정"]);
  assert.deepEqual(p.photoSections, [0, 2]);
  assert.equal(p.blocks.length, 3); // 문장 분리 적용
});

test("사진 분석 파싱: extractedText 문자열도 배열로 정규화", () => {
  assert.deepEqual(parseAnalysis({ description: "d", suggestedSectionTopic: "s", extractedText: "**메뉴**\n아메리카노 - 4,500원" }, "x").extractedText, ["**메뉴**", "아메리카노 - 4,500원"]);
  assert.deepEqual(parseAnalysis({ extractedText: ["a", " ", "b"] }, "x").extractedText, ["a", "b"]);
  assert.equal(parseAnalysis({ extractedText: null }, "x").extractedText, null);
});

test("말투 통계: 'ㅎㅎ'·물결은 전체 텍스트 기준으로 센다(문장 끝 매칭이면 0%가 되던 버그)", () => {
  const s = computeEndingStats(["오늘 다녀왔어요 ㅎㅎ 정말 좋았어요~ 또 갈게요!"]);
  assert.ok(s.laughOrCry > 0, JSON.stringify(s));
  assert.ok(s.tilde > 0, JSON.stringify(s));
  assert.ok(s.polite > 0.5, JSON.stringify(s));
});

test("이미지 배치: 업로드 사진이 메인, 카드는 추가 이미지", () => {
  const plan = planImages([
    { id: "lead", slotIndex: -1, sourceRef: "upload:a" },
    { id: "card0", slotIndex: 0, sourceRef: "card:0" },
    { id: "stock0", slotIndex: 0, sourceRef: "https://unsplash" },
    { id: "up0", slotIndex: 0, sourceRef: "upload:b" },
  ], 2);
  assert.equal(plan.lead?.id, "lead");
  assert.equal(plan.sectionMain[0]?.id, "up0");
  assert.deepEqual(plan.sectionExtras[0].map((x) => x.id), ["card0", "stock0"]);
  assert.equal(plan.sectionMain[1], null);
});

test("블로그탭: 2026-10 실제 링크 구성에서 제목=첫 의미 있는 링크, 요약문=그다음 긴 텍스트", () => {
  // 라이브에서 본 순서: 썸네일("새 창 열림") → 블로그명 → 제목 → 요약문 → 사진 링크들
  const u = "https://blog.naver.com/drama-tic/224453876929";
  const links = [
    { href: "https://blog.naver.com/drama-tic", text: "도치의 DRAMATIC❤️새 창 열림", heatmap: "articleSourceJSX_title" },
    { href: u, text: "새 창 열림", heatmap: ".nblg" },
    { href: u, text: "마포 합정역 맛집 기념일 데이트 추천 후기새 창 열림", heatmap: ".nblg" },
    { href: u, text: "마포 합정 맛집 기념일 데이트 추천 후기 결혼기념일이라 맛있는 저녁을 먹고 싶어서 다녀왔어요.새 창 열림", heatmap: ".nblg" },
    { href: u, text: "새 창 열림", heatmap: ".nblg" },
    { href: "https://blog.naver.com/b/224454663599", text: "[최강금돈까스] 합정 돈까스 맛집 후기새 창 열림", heatmap: ".nblg" },
  ];
  const posts = pickPostLinks(links);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "마포 합정역 맛집 기념일 데이트 추천 후기");
  assert.ok(posts[0].excerpt.startsWith("마포 합정 맛집 기념일 데이트 추천 후기 결혼기념일"));
  assert.equal(posts[1].title, "[최강금돈까스] 합정 돈까스 맛집 후기");
  assert.equal(cleanLinkText("제목새 창 열림"), "제목");
});

// ----------------------------------------------------------------
console.log(`\n${passed}개 통과, ${failures.length}개 실패`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
