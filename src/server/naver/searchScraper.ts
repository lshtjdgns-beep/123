import "server-only";
import { getPublicContext } from "../browser/playwrightManager";
import { naverSearch } from "./naverSelectors";
import type { NewSource } from "../db/repositories/sources";

export type BlogTabResult = { rank: number; blogId: string; postNo: string; url: string; title: string; excerpt: string };

type RawLink = { href: string; text: string; heatmap: string | null };

/** 네이버가 링크마다 붙이는 접근성 문구("새 창 열림") 제거 */
export function cleanLinkText(s: string): string {
  return s.replace(/새\s*창\s*열림/g, "").replace(/\s+/g, " ").trim();
}

const MIN_TITLE = 5;

/**
 * 블로그탭 1~N위.
 * 한 글이 썸네일/블로그명/제목/요약문 등 여러 <a>로 나온다. blog.naver.com/{blogId}/{postNo}
 * 패턴의 링크만 모아 글별로 묶고, 등장 순서를 순위로 쓴다.
 *
 * ⚠ 원래 사양은 "같은 글은 텍스트가 가장 긴 것을 제목으로"였지만, 2026-10 라이브 확인 결과
 * 지금 레이아웃은 요약문 <a>도 같은 글로 링크돼서 가장 긴 텍스트가 요약문이다(제목 자리에
 * 본문 발췌가 들어가는 버그). 이제는 "의미 있는 텍스트(5자 이상)를 가진 첫 링크 = 제목",
 * "그 뒤의 가장 긴 텍스트 = 요약문"으로 고른다. 썸네일 링크는 텍스트가 "새 창 열림"뿐이라
 * 제거 후 빈 문자열이 되어 자동으로 걸러진다. 네이버가 .tit/.body 표식을 붙이면 그걸 우선한다.
 */
export function pickPostLinks(links: RawLink[]): { blogId: string; postNo: string; title: string; excerpt: string }[] {
  const byPost = new Map<string, { order: number; blogId: string; postNo: string; title: string; excerpt: string; titleFromTag: boolean }>();
  let order = 0;
  for (const l of links) {
    const m = naverSearch.postLinkPattern.exec(l.href);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`;
    const text = cleanLinkText(l.text);
    let p = byPost.get(key);
    if (!p) {
      p = { order: order++, blogId: m[1], postNo: m[2], title: "", excerpt: "", titleFromTag: false };
      byPost.set(key, p);
    }
    if (!text) continue;
    if (l.heatmap === ".tit") { p.title = text; p.titleFromTag = true; continue; }
    if (l.heatmap === ".body") { p.excerpt = text; continue; }
    if (!p.title && text.length >= MIN_TITLE) { p.title = text; continue; }
    if (text !== p.title && text.length > p.excerpt.length) p.excerpt = text;
  }
  return [...byPost.values()]
    .sort((a, b) => a.order - b.order)
    .filter((p) => p.title.length >= 2)
    .map(({ blogId, postNo, title, excerpt }) => ({ blogId, postNo, title, excerpt: excerpt.slice(0, 400) }));
}

export async function scrapeBlogTabRanking(keyword: string, limit = 5): Promise<BlogTabResult[]> {
  const context = await getPublicContext();
  try {
    const page = await context.newPage();
    await page.goto(naverSearch.blogTabUrl(keyword), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const links: RawLink[] = await page.$$eval("a[href*='blog.naver.com']", (as) =>
      as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent ?? "", heatmap: a.getAttribute("data-heatmap-target") })),
    );
    return pickPostLinks(links)
      .slice(0, limit)
      .map((p, i) => ({ rank: i + 1, ...p, url: `https://blog.naver.com/${p.blogId}/${p.postNo}` }));
  } finally {
    await context.close();
  }
}

/**
 * 뉴스: 제목 링크는 data-heatmap-target=".tit", 요약문은 ".body"(같은 href). 라이브 확인.
 * 표식이 없는 레이아웃이면 12자 이상 텍스트 링크로 폴백(안내 배너·Keep 링크 제외).
 */
export async function scrapeNews(keyword: string, limit = 10): Promise<NewSource[]> {
  const context = await getPublicContext();
  try {
    const page = await context.newPage();
    await page.goto(naverSearch.newsUrl(keyword), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const links: RawLink[] = await page.$$eval("#main_pack a[href^='http']", (as) =>
      as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent ?? "", heatmap: a.getAttribute("data-heatmap-target") })),
    );
    const excerpts = new Map<string, string>();
    for (const l of links) if (l.heatmap === ".body") excerpts.set(l.href, cleanLinkText(l.text));
    const tagged = links.filter((l) => l.heatmap === ".tit");
    const candidates = (tagged.length ? tagged : links).filter(
      (l) => cleanLinkText(l.text).length >= 12 && !/search\.naver\.com|help\.naver|keep\.naver|news\.naver\.com\/main\/static/.test(l.href),
    );
    const seen = new Set<string>();
    const out: NewSource[] = [];
    for (const l of candidates) {
      if (seen.has(l.href)) continue;
      seen.add(l.href);
      out.push({ type: "news", title: cleanLinkText(l.text), url: l.href, excerpt: excerpts.get(l.href) ?? null });
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    await context.close();
  }
}

/** 검색자료(뉴스 + 블로그 상위글 발췌) — 프롬프트의 사실 근거(factCorpus)가 된다 */
export async function collectSources(keyword: string): Promise<NewSource[]> {
  const [news, blogs] = await Promise.all([
    scrapeNews(keyword).catch((e) => {
      console.warn("[search] 뉴스 수집 실패:", (e as Error).message);
      return [] as NewSource[];
    }),
    scrapeBlogTabRanking(keyword, 10).catch((e) => {
      console.warn("[search] 블로그 수집 실패:", (e as Error).message);
      return [] as BlogTabResult[];
    }),
  ]);
  return [...news, ...blogs.map((b): NewSource => ({ type: "blog", title: b.title, url: b.url, excerpt: b.excerpt }))];
}
