import "server-only";
import { getPublicContext } from "../browser/playwrightManager";
import { naverSearch } from "./naverSelectors";
import type { NewSource } from "../db/repositories/sources";

export type BlogTabResult = { rank: number; blogId: string; postNo: string; url: string; title: string; excerpt: string };

type RawLink = { href: string; text: string; context: string };

/**
 * 블로그탭 1~N위.
 * 한 글이 썸네일/블로그명/제목 등 여러 <a>로 나오므로 blog.naver.com/{blogId}/{postNo}
 * 패턴의 모든 링크를 모으되, 같은 글은 텍스트가 가장 긴 것을 제목으로 채택한다
 * (썸네일 링크는 텍스트가 없거나 짧다). 등장 순서 = 순위.
 */
export async function scrapeBlogTabRanking(keyword: string, limit = 5): Promise<BlogTabResult[]> {
  const context = await getPublicContext();
  try {
    const page = await context.newPage();
    await page.goto(naverSearch.blogTabUrl(keyword), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const links: RawLink[] = await page.$$eval("a[href*='blog.naver.com']", (as) =>
      as.map((a) => {
        const el = a as HTMLAnchorElement;
        // 결과 카드(가장 가까운 li / 큰 div)의 텍스트를 발췌로 쓴다
        const card = el.closest("li, .view_wrap, .total_wrap, .detail_box, .api_txt_lines")?.textContent ?? "";
        return { href: el.href, text: (el.textContent ?? "").replace(/\s+/g, " ").trim(), context: card.replace(/\s+/g, " ").trim().slice(0, 400) };
      }),
    );
    const byPost = new Map<string, { order: number; blogId: string; postNo: string; title: string; excerpt: string }>();
    let order = 0;
    for (const l of links) {
      const m = naverSearch.postLinkPattern.exec(l.href);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      const existing = byPost.get(key);
      if (!existing) {
        byPost.set(key, { order: order++, blogId: m[1], postNo: m[2], title: l.text, excerpt: l.context });
      } else {
        if (l.text.length > existing.title.length) existing.title = l.text;
        if (l.context.length > existing.excerpt.length) existing.excerpt = l.context;
      }
    }
    return [...byPost.values()]
      .sort((a, b) => a.order - b.order)
      .filter((p) => p.title.length >= 2)
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        blogId: p.blogId,
        postNo: p.postNo,
        url: `https://blog.naver.com/${p.blogId}/${p.postNo}`,
        title: p.title,
        excerpt: p.excerpt,
      }));
  } finally {
    await context.close();
  }
}

export async function scrapeNews(keyword: string, limit = 10): Promise<NewSource[]> {
  const context = await getPublicContext();
  try {
    const page = await context.newPage();
    await page.goto(naverSearch.newsUrl(keyword), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const items = await page.$$eval("#main_pack a[href^='http']", (as) =>
      as
        .map((a) => {
          const el = a as HTMLAnchorElement;
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          const card = el.closest("li, .news_area, .sds-comps-vertical-layout")?.textContent ?? "";
          return { href: el.href, text, excerpt: card.replace(/\s+/g, " ").trim().slice(0, 400) };
        })
        .filter((x) => x.text.length >= 12 && !/search\.naver\.com|help\.naver|keep\.naver/.test(x.href)),
    );
    const seen = new Set<string>();
    const out: NewSource[] = [];
    for (const it of items) {
      if (seen.has(it.href)) continue;
      seen.add(it.href);
      out.push({ type: "news", title: it.text, url: it.href, excerpt: it.excerpt });
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
