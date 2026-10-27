import "server-only";
import type { BrowserContext } from "playwright";
import { getPublicContext } from "../browser/playwrightManager";
import { naverPost } from "./naverSelectors";

export type NaverPostContent = {
  url: string;
  title: string;
  fullText: string;
  paragraphs: string[];
  imageCount: number;
  tableCount: number;
  hasMap: boolean;
  headings: string[];
};

/** 공개 글 하나를 읽는다. 본문은 iframe[name=mainFrame] 안에 있다. */
export async function readNaverPost(url: string, context?: BrowserContext): Promise<NaverPostContent> {
  const ctx = context ?? (await getPublicContext());
  try {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const frameEl = await page.waitForSelector(`iframe[name=${naverPost.mainFrameName}]`, { timeout: 15000 }).catch(() => null);
      const frame = (frameEl ? await frameEl.contentFrame() : null) ?? page.mainFrame();
      await frame.waitForSelector(naverPost.mainContainer, { timeout: 15000 });
      // ⚠ 브라우저 안에서 실행되는 함수에는 이름 붙은 헬퍼(const f = () => …)를 두지 않는다.
      // 번들러/tsx가 그런 함수에 __name(...) 래퍼를 끼워 넣는데, 페이지 안에는 __name이 없어서
      // "ReferenceError: __name is not defined"로 실패한다(라이브 확인). 원문만 가져와서 정리는 Node에서.
      const raw = await frame.evaluate((sel) => {
        const container = document.querySelector(sel.mainContainer);
        return {
          title: sel.titleCandidates.map((c) => document.querySelector(c)?.textContent ?? "").find((t) => t.trim()) ?? "",
          containerText: container?.textContent ?? "",
          paragraphs: container ? Array.from(container.querySelectorAll(sel.paragraph), (p) => p.textContent ?? "") : [],
          headings: container ? Array.from(container.querySelectorAll(sel.headingCandidates), (p) => p.textContent ?? "") : [],
          imageCount: container ? container.querySelectorAll(sel.imageNodes).length : 0,
          tableCount: container ? container.querySelectorAll(sel.tableNodes).length : 0,
          hasMap: Boolean(container?.querySelector(sel.mapNodes)),
        };
      }, { mainContainer: naverPost.mainContainer, paragraph: naverPost.paragraph, headingCandidates: naverPost.headingCandidates, imageNodes: naverPost.imageNodes, tableNodes: naverPost.tableNodes, mapNodes: naverPost.mapNodes, titleCandidates: naverPost.titleCandidates });
      const clean = (t: string) => t.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
      const paragraphs = raw.paragraphs.map(clean).filter(Boolean);
      return {
        url,
        title: clean(raw.title),
        fullText: paragraphs.length ? paragraphs.join("\n") : clean(raw.containerText),
        paragraphs,
        imageCount: raw.imageCount,
        tableCount: raw.tableCount,
        hasMap: raw.hasMap,
        headings: [...new Set(raw.headings.map(clean).filter(Boolean))],
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (!context) await ctx.close().catch(() => {});
  }
}

export type PostRef = { blogId: string; postNo: string; url: string; title: string };

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

/**
 * 1순위: RSS. `PostList.naver` 페이지의 링크 형식이 예전 `PostView.naver?blogId=..&logNo=..`
 * 에서 바뀌어 그 셀렉터로는 0개가 읽히는 버그가 실제로 있었다. RSS는
 * `<link>https://blog.naver.com/{blogId}/{postNo}...</link>` 형태로 안정적이고 이미 최신순.
 */
async function recentPostsFromRss(blogId: string, limit: number): Promise<PostRef[]> {
  const res = await fetch(naverPost.rssUrl(blogId), { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const out: PostRef[] = [];
  for (const it of items) {
    const link = decodeXml(/<link>([\s\S]*?)<\/link>/.exec(it)?.[1] ?? "");
    const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(it)?.[1] ?? "");
    const m = /blog\.naver\.com\/([\w-]+)\/(\d{6,})/.exec(link);
    if (!m) continue;
    out.push({ blogId: m[1], postNo: m[2], url: naverPost.url(m[1], m[2]), title });
    if (out.length >= limit) break;
  }
  return out;
}

/** 폴백: PostList 페이지 스캔. 신/구 링크 형식 둘 다 시도. */
async function recentPostsFromPostList(blogId: string, limit: number): Promise<PostRef[]> {
  const ctx = await getPublicContext();
  try {
    const page = await ctx.newPage();
    await page.goto(naverPost.postListUrl(blogId), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const hrefs: { href: string; text: string }[] = [];
    for (const f of page.frames()) {
      const found = await f
        .$$eval("a[href]", (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? "").trim() })))
        .catch(() => []);
      hrefs.push(...found);
    }
    const seen = new Set<string>();
    const out: PostRef[] = [];
    for (const { href, text } of hrefs) {
      let id: string | undefined;
      let no: string | undefined;
      const a = /blog\.naver\.com\/([\w-]+)\/(\d{6,})/.exec(href);
      const b = /[?&]blogId=([\w-]+).*?[?&]logNo=(\d{6,})/.exec(href);
      if (a) [, id, no] = a;
      else if (b) [, id, no] = b;
      if (!id || !no || id !== blogId || seen.has(no)) continue;
      seen.add(no);
      out.push({ blogId: id, postNo: no, url: naverPost.url(id, no), title: text });
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function fetchRecentPostRefs(blogId: string, limit = 3): Promise<PostRef[]> {
  try {
    const rss = await recentPostsFromRss(blogId, limit);
    if (rss.length) return rss;
  } catch (e) {
    console.warn("[style] RSS 읽기 실패, PostList로 폴백:", (e as Error).message);
  }
  return recentPostsFromPostList(blogId, limit);
}

/** 내 블로그 최근 글 N개 본문 */
export async function scrapeRecentPosts(blogId: string, limit = 3): Promise<(PostRef & { text: string })[]> {
  const refs = await fetchRecentPostRefs(blogId, limit);
  if (!refs.length) return [];
  const ctx = await getPublicContext();
  try {
    const out: (PostRef & { text: string })[] = [];
    for (const r of refs) {
      try {
        const post = await readNaverPost(r.url, ctx);
        if (post.fullText.length > 50) out.push({ ...r, title: r.title || post.title, text: post.fullText });
      } catch (e) {
        console.warn("[style] 글 읽기 실패:", r.url, (e as Error).message);
      }
    }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}
