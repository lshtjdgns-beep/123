import "server-only";
import type { Frame, Page } from "playwright";
import { launchHeadedNaverContext, saveStorageState } from "../browser/playwrightManager";
import { smartEditor as sel } from "./naverSelectors";
import { sessionStatePath } from "@/lib/paths";
import { parseMarkedRuns, wrapIntoRunLines, type Mark } from "@/lib/centeredLineWrap";
import { splitIntoSections, removeFirstMatchingParagraph } from "@/lib/sectionAssignment";
import { randomExtraGap } from "@/lib/imagePlan";
import type { ContentBlock } from "@/lib/textToHtml";

export type PublishMode = "draft" | "live";
export type Visibility = keyof typeof sel.visibilityRadioLabel;

export type PublishInput = {
  blogId: string;
  title: string;
  blocks: ContentBlock[];
  leadImagePath: string | null;
  /** 소제목 i 바로 아래 메인 사진 */
  sectionImagePaths: (string | null)[];
  /** 소제목 i 섹션 안에 2~3문장마다 흩뿌릴 추가 이미지 */
  sectionExtraPaths: string[][];
  /** 소제목 i 사진 아래 캡션으로 쓸 강조 문장(원래 위치에서는 제거) */
  sectionCaptions: (string | null)[];
  tags: string[];
  places: string[];
  mode: PublishMode;
  visibility?: Visibility;
  onProgress?: (msg: string) => void;
};

export type PublishResult = { success: boolean; url: string | null; error: string | null };

/**
 * 에디터 상태.
 *  - 타이핑모드 토글(굵게/밑줄/하이라이트): "이제부터 입력하는 글자"에 적용 → 켜고·타이핑·끄기로만 다룬다.
 *  - 현재상태 적용 버튼(정렬, 표 셀 배경색): 커서/셀에 직접 적용 → 끝나고 "리셋"을 부르지 않는다.
 *    정렬은 문서 전체에서 딱 한 번(첫 문단에 텍스트가 생긴 직후) 설정하면 이후 문단에 상속된다.
 */
type EditorState = { fresh: boolean; alignmentSet: boolean; marks: Record<Mark, boolean> };

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

async function isVisible(frame: Frame, selector: string, timeout = 1500): Promise<boolean> {
  try {
    await frame.locator(selector).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 진입/팝업

async function getEditorFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const frame = page.frame({ name: sel.mainFrameName });
    if (frame && (await frame.locator(sel.titleArea).count().catch(() => 0)) > 0) return frame;
    await wait(page, 500);
  }
  throw new Error("네이버 에디터(mainFrame)를 찾지 못했습니다. 네이버 화면을 확인해주세요.");
}

/**
 * 로그인된 세션이 실제로는 다른 계정인데 활성 blogId로 글쓰기 페이지에 들어가면, 네이버가
 * 에러 없이 그 다른 계정의 홈으로 조용히 리다이렉트한다. 여기서 잡지 않으면 "에디터
 * iframe을 못 찾음" 같은 엉뚱한 타임아웃으로 원인을 알 수 없게 된다.
 */
function assertBlogIdMatches(page: Page, blogId: string) {
  const url = page.url();
  if (/nid\.naver\.com/.test(url)) throw new Error("네이버 로그인이 만료되었습니다. 설정 페이지에서 다시 로그인해주세요.");
  if (url.includes("PostWriteForm.naver")) return;
  const m = /blog\.naver\.com\/([\w-]+)/.exec(url);
  if (m && m[1] !== blogId && !/\.naver$/.test(m[1])) {
    throw new Error(`로그인된 네이버 세션은 "${m[1]}" 계정인데, 활성 블로그는 "${blogId}"입니다. 설정에서 계정을 전환하거나 해당 계정으로 다시 로그인해주세요.`);
  }
}

async function dismissContinueWritingPopup(frame: Frame) {
  if (await isVisible(frame, sel.continueWritingPopup.cancelButton, 3000)) {
    await frame.locator(sel.continueWritingPopup.cancelButton).first().click();
    await wait(frame.page(), 400);
  }
}

async function dismissHelpPanel(frame: Frame) {
  if (await isVisible(frame, sel.helpPanelCloseButton, 1500)) {
    await frame.locator(sel.helpPanelCloseButton).first().click();
    await wait(frame.page(), 300);
  }
}

// ---------------------------------------------------------------- 서식 토글

// ⚠ 굵게/밑줄은 반드시 툴바 버튼 클릭으로. Ctrl+B/Ctrl+U는 Enter 직후(새 문단이 안정화되기
// 전)에 누르면 키 입력이 씹혀 토글이 한 박자 밀리고, 글 나머지 전체에 밑줄이 번지는 버그가
// 된다. waitForTimeout을 늘려도 안 고쳐졌고, 툴바 버튼으로 바꾸니 완전히 해결됐다.
async function toggleBold(frame: Frame) {
  await frame.locator(sel.bold.toolbarButton).first().click();
  await wait(frame.page(), 80);
}

async function toggleUnderline(frame: Frame) {
  await frame.locator(sel.underline.toolbarButton).first().click();
  await wait(frame.page(), 80);
}

// ⚠ 하이라이트를 "평문으로 타이핑 후 Selection API로 재선택해 색 입히기"로 구현하면 색이
// 켜진 채로 뒤 문단이 전부 하이라이트되는 버그가 난다. 반드시 켜기 → 입력 → 끄기.
// 켤 때와 끌 때 모두 같은 노란 스와치를 누른다(팔레트가 토글로 동작).
async function toggleHighlight(frame: Frame) {
  await frame.locator(sel.highlight.toolbarButton).first().click();
  await wait(frame.page(), 150);
  await frame.locator(sel.highlight.swatch(sel.highlight.yellow)).first().click();
  await wait(frame.page(), 120);
}

async function applyMarks(frame: Frame, state: EditorState, desired: Set<Mark>) {
  if (state.marks.bold !== desired.has("bold")) { await toggleBold(frame); state.marks.bold = !state.marks.bold; }
  if (state.marks.underline !== desired.has("underline")) { await toggleUnderline(frame); state.marks.underline = !state.marks.underline; }
  if (state.marks.highlight !== desired.has("highlight")) { await toggleHighlight(frame); state.marks.highlight = !state.marks.highlight; }
}

const NO_MARKS = new Set<Mark>();

/** 정렬 드롭다운은 빈 문서 상태에선 렌더되지 않아 타임아웃 난다 — 첫 텍스트 직후 1회만 */
async function setAlignmentCenterOnce(frame: Frame, state: EditorState) {
  if (state.alignmentSet) return;
  try {
    await frame.locator(sel.align.dropdownToggle).first().click({ timeout: 5000 });
    await wait(frame.page(), 150);
    await frame.locator(sel.align.centerButton).first().click({ timeout: 5000 });
    await wait(frame.page(), 150);
  } catch (e) {
    console.warn("[publish] 가운데 정렬 설정 실패(계속 진행):", (e as Error).message);
  }
  state.alignmentSet = true;
}

// ---------------------------------------------------------------- 텍스트

async function typeRuns(frame: Frame, state: EditorState, runs: { text: string; marks: Mark[] }[]) {
  const page = frame.page();
  for (const run of runs) {
    await applyMarks(frame, state, new Set(run.marks));
    await page.keyboard.type(run.text, { delay: 8 });
    if (state.fresh) {
      state.fresh = false;
      await setAlignmentCenterOnce(frame, state);
    }
  }
  await applyMarks(frame, state, NO_MARKS);
}

/** 문단 하나 = 8~15자 줄 여러 개(가운데 정렬) + 빈 줄 */
async function typeParagraph(frame: Frame, state: EditorState, text: string) {
  const page = frame.page();
  for (const line of wrapIntoRunLines(text)) {
    await typeRuns(frame, state, line);
    await page.keyboard.press("Enter");
    await wait(page, 60);
  }
  await page.keyboard.press("Enter");
  await wait(page, 60);
}

// ---------------------------------------------------------------- 컴포넌트

/**
 * 인용구/표 안에 커서가 있으면 Enter는 "다음 줄 추가"라 컴포넌트를 못 빠져나온다.
 * 마지막 컴포넌트의 bounding box 바로 아래 빈 공간을 클릭해서 새 일반 문단으로 나온다.
 */
async function clickBelowLastComponent(frame: Frame, componentSelector = ".se-component") {
  const page = frame.page();
  const comp = frame.locator(componentSelector).last();
  const box = await comp.boundingBox();
  if (!box) throw new Error("컴포넌트 위치를 찾지 못했습니다.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 18);
  await wait(page, 250);
}

async function insertQuotation(frame: Frame, style: "underline" | "corner") {
  // 드롭다운 토글은 2개 매칭 — 두 번째가 스타일 목록을 연다
  await frame.locator(sel.quotation.dropdownToggle).nth(1).click();
  await wait(frame.page(), 250);
  await frame.locator(style === "underline" ? sel.quotation.underlineStyleButton : sel.quotation.cornerStyleButton).first().click();
  await wait(frame.page(), 400);
}

async function typeHeading(frame: Frame, state: EditorState, text: string) {
  await applyMarks(frame, state, NO_MARKS);
  await insertQuotation(frame, "underline");
  await frame.page().keyboard.type(text, { delay: 8 });
  await clickBelowLastComponent(frame, sel.quotation.component);
}

/** 목차/사진텍스트: 모서리 인용구, 줄마다 한 줄 */
async function typeBoxLines(frame: Frame, state: EditorState, lines: string[]) {
  const page = frame.page();
  await applyMarks(frame, state, NO_MARKS);
  await insertQuotation(frame, "corner");
  for (let i = 0; i < lines.length; i++) {
    await typeRuns(frame, state, parseMarkedRuns(lines[i]));
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
  await clickBelowLastComponent(frame, sel.quotation.component);
}

async function setCellBackground(frame: Frame, hex: string) {
  await frame.locator(sel.table.cellBackgroundColorButton).first().click();
  await wait(frame.page(), 150);
  await frame.locator(sel.highlight.swatch(hex)).first().click();
  await wait(frame.page(), 120);
}

/** 표: 3x3 고정, Tab 이동 안 됨 → 셀마다 개별 클릭. ⚠ 다 칠한 뒤 배경색 "리셋"을 부르지 말 것
 *  (커서가 마지막 셀에 있어서 리셋이 마지막 셀 색을 지운다 — 9칸 중 마지막 칸만 색이 빠지던 버그) */
async function typeTable(frame: Frame, state: EditorState, rows: string[][]) {
  const page = frame.page();
  await applyMarks(frame, state, NO_MARKS);
  await frame.locator(sel.table.insertButton).first().click();
  await wait(page, 600);
  const table = frame.locator(sel.table.component).last();
  const cells = table.locator(sel.table.cell);
  const count = Math.min(await cells.count(), 9);
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    await cells.nth(i).click();
    await wait(page, 100);
    await setCellBackground(frame, r === 0 ? sel.highlight.yellow : sel.table.bodyRowGrey).catch((e) =>
      console.warn("[publish] 셀 배경색 실패:", (e as Error).message),
    );
    const text = rows[r]?.[c] ?? "";
    if (text) await typeRuns(frame, state, [{ text: text.replace(/\*\*|__|==/g, ""), marks: r === 0 ? ["bold"] : [] }]);
  }
  await clickBelowLastComponent(frame, sel.table.component);
}

async function ensureTextCaret(frame: Frame) {
  if (await isVisible(frame, sel.bold.toolbarButton, 2000)) return;
  await clickBelowLastComponent(frame).catch(() => {});
  if (await isVisible(frame, sel.bold.toolbarButton, 2000)) return;
  throw new Error("이미지 삽입 후 본문 텍스트 커서를 복구하지 못했습니다.");
}

async function insertSingleImage(frame: Frame, imagePath: string) {
  const page = frame.page();
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await frame.locator(sel.imageToolbarButton).first().click();
  await (await chooser).setFiles(imagePath);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Enter");

  const closeBtn = frame.locator(sel.librarySidebarCloseButton).first();
  if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(200);
    // ⚠ 이 클릭이 실제 DOM 포커스를 버튼으로 뺏어간다. 정렬 같은 툴바 명령은 에디터 내부의
    // 논리적 커서로 동작해서 괜찮지만, page.keyboard.type()은 실제 DOM 포커스가 있는 요소로
    // 키 이벤트를 보내므로 다음 텍스트가 버튼으로 들어가 통째로 사라진다(리드 이미지 뒤
    // 첫 줄이 계속 안 보이던 버그). 포커스를 본문으로 되돌린다.
    // ⚠ force 필수: 방금 만들어진 빈 문단 위에 에디터 자신의 캐럿(se-caret, .se-selection
    // 레이어)이 얹혀 있어서 force 없이는 Playwright "가려짐 없음" 검사가 30초 내내 실패한다.
    await frame.locator(sel.bodyParagraph).last().click({ force: true, timeout: 5000 });
    await page.waitForTimeout(100);
  }
  await ensureTextCaret(frame);
}

// ---------------------------------------------------------------- 장소

async function closePlacePopup(frame: Frame) {
  const page = frame.page();
  if (!(await isVisible(frame, sel.place.popup, 500))) return;
  const close = frame.locator(sel.place.closeButton).first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  else await page.keyboard.press("Escape");
  await wait(page, 300);
  if (await isVisible(frame, sel.place.popup, 300)) await page.keyboard.press("Escape");
}

/** 글이 길수록(이미지 30장+) 에디터가 느려진다 — 1.2초 고정 대기로는 "결과 없음" 오판 */
async function searchPlaceOnce(frame: Frame, query: string): Promise<boolean> {
  const page = frame.page();
  const input = frame.locator(sel.place.searchInput).first();
  await input.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await input.type(query, { delay: 20 });
  for (let attempt = 0; attempt < 2; attempt++) {
    await frame.locator(sel.place.searchButton).first().click().catch(() => page.keyboard.press("Enter"));
    for (let i = 0; i < 12; i++) {
      await wait(page, 500);
      if ((await frame.locator(sel.place.resultItem).count()) > 0) return true;
    }
  }
  return false;
}

async function insertPlace(frame: Frame, place: string): Promise<boolean> {
  const page = frame.page();
  await frame.locator(sel.place.insertButton).first().click();
  await frame.locator(sel.place.popup).first().waitFor({ state: "visible", timeout: 10000 });
  // 네이버 지도 정식명은 "OO점" 없이 등록된 경우가 많다
  const queries = [place, ...(/점$/.test(place) ? [place.replace(/\s*\S*점$/, "").trim() || place.slice(0, -1)] : [])];
  for (const q of queries) {
    if (!q || !(await searchPlaceOnce(frame, q))) continue;
    const item = frame.locator(sel.place.resultItem).first();
    await item.hover();
    await wait(page, 200);
    await item.locator(sel.place.addButtonInResult).first().click({ force: true }); // hover해야 보임
    await wait(page, 300);
    await frame.locator(sel.place.confirmButton).last().click();
    await wait(page, 800);
    return true;
  }
  // ⚠ 못 찾았으면 반드시 닫는다 — 팝업이 남으면 마지막 "저장" 버튼을 가려 30초 타임아웃
  await closePlacePopup(frame);
  return false;
}

async function insertPlaces(frame: Frame, places: string[], onProgress?: (m: string) => void) {
  for (const p of places) {
    onProgress?.(`장소 "${p}" 첨부 중…`);
    try {
      const ok = await insertPlace(frame, p);
      if (!ok) console.warn("[publish] 장소 검색 결과 없음:", p);
    } catch (e) {
      console.warn("[publish] 장소 첨부 실패:", p, (e as Error).message);
      await closePlacePopup(frame);
    }
  }
}

// ---------------------------------------------------------------- 저장/발행

async function submitSaveDraft(frame: Frame) {
  const page = frame.page();
  await closePlacePopup(frame);
  const btn = frame.locator(sel.saveDraftButton).first();
  try {
    await btn.click({ timeout: 8000 });
  } catch {
    await btn.click({ force: true, timeout: 8000 });
  }
  await wait(page, 2500);
}

async function submitPublish(frame: Frame, tags: string[], visibility: Visibility, blogId: string): Promise<string | null> {
  const page = frame.page();
  await closePlacePopup(frame);
  await frame.locator(sel.publishOpenButton).first().click({ timeout: 8000 });
  await wait(page, 800);
  const tagInput = frame.locator(sel.tagInput).first();
  if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    for (const t of tags.slice(0, 30)) {
      await tagInput.click();
      await tagInput.type(t, { delay: 15 });
      await page.keyboard.press("Enter");
      await wait(page, 120);
    }
  }
  await frame.locator(sel.visibilityRadioLabel[visibility]).first().click({ timeout: 3000 }).catch(() => {});
  await frame.locator(sel.publishConfirmButton).first().click({ timeout: 8000 });
  const re = new RegExp(`blog\\.naver\\.com/${blogId}/(\\d+)|logNo=(\\d+)`);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const urls = [page.url(), ...page.frames().map((f) => f.url())];
    const hit = urls.find((u) => re.test(u));
    if (hit) return hit;
    await wait(page, 500);
  }
  return page.url();
}

// ---------------------------------------------------------------- 본문 조립

async function typeBlock(frame: Frame, state: EditorState, b: ContentBlock) {
  switch (b.type) {
    case "paragraph": return typeParagraph(frame, state, b.text);
    case "heading": return typeHeading(frame, state, b.text);
    case "table": return typeTable(frame, state, b.rows);
    case "toc": return typeBoxLines(frame, state, b.items);
    case "photoQuote": return typeBoxLines(frame, state, b.text.split("\n"));
  }
}

async function fillBody(frame: Frame, input: PublishInput, state: EditorState) {
  const { onProgress } = input;
  await frame.locator(sel.bodyParagraph).first().click({ force: true });
  await wait(frame.page(), 200);

  if (input.leadImagePath) {
    onProgress?.("리드 이미지 삽입 중…");
    await insertSingleImage(frame, input.leadImagePath);
  }

  const sections = splitIntoSections(input.blocks);
  for (const b of sections[0].blocks) await typeBlock(frame, state, b);

  for (let s = 1; s < sections.length; s++) {
    const idx = s - 1;
    onProgress?.(`본문 입력 중 (소제목 ${idx + 1}/${sections.length - 1})…`);
    await typeHeading(frame, state, sections[s].heading ?? "");
    let blocks = sections[s].blocks;
    const main = input.sectionImagePaths[idx];
    const caption = input.sectionCaptions[idx];
    if (main) {
      await insertSingleImage(frame, main);
      if (caption) {
        // 같은 문장을 본문에 또 쓰면 중복 — 원래 위치에서는 제거
        await typeParagraph(frame, state, caption);
        blocks = removeFirstMatchingParagraph(blocks, caption);
      }
    }
    // 추가 이미지는 몰아넣지 말고 문장 2~3개마다 하나씩
    const extras = [...(input.sectionExtraPaths[idx] ?? [])];
    let gap = randomExtraGap();
    let sinceLast = 0;
    for (const b of blocks) {
      await typeBlock(frame, state, b);
      if (b.type === "paragraph") sinceLast++;
      if (extras.length && sinceLast >= gap) {
        await insertSingleImage(frame, extras.shift()!);
        sinceLast = 0;
        gap = randomExtraGap();
      }
    }
    for (const rest of extras) await insertSingleImage(frame, rest);
  }
}

export async function publishToNaver(input: PublishInput): Promise<PublishResult> {
  const { blogId, onProgress } = input;
  const context = await launchHeadedNaverContext(blogId);
  try {
    const page = await context.newPage();
    onProgress?.("네이버 글쓰기 화면 여는 중…");
    await page.goto(sel.writeUrlTemplate(blogId), { waitUntil: "domcontentloaded", timeout: 45000 });
    await wait(page, 3000);
    assertBlogIdMatches(page, blogId);
    const frame = await getEditorFrame(page);
    await dismissContinueWritingPopup(frame);
    await dismissHelpPanel(frame);

    onProgress?.("제목 입력 중…");
    await frame.locator(sel.titleArea).first().click();
    await page.keyboard.type(input.title, { delay: 10 });

    const state: EditorState = { fresh: true, alignmentSet: false, marks: { bold: false, underline: false, highlight: false } };
    await fillBody(frame, input, state);

    if (input.places.length) await insertPlaces(frame, input.places, onProgress);

    let url: string | null;
    if (input.mode === "draft") {
      onProgress?.("임시저장 중…");
      await submitSaveDraft(frame);
      url = page.url();
    } else {
      onProgress?.("발행 중…");
      url = await submitPublish(frame, input.tags, input.visibility ?? "public", blogId);
    }
    await saveStorageState(context, sessionStatePath(blogId)).catch(() => {});
    return { success: true, url, error: null };
  } catch (e) {
    return { success: false, url: null, error: (e as Error).message };
  } finally {
    await context.close().catch(() => {});
  }
}
