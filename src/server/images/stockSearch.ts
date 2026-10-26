import "server-only";

export type StockPhoto = { url: string; sourceRef: string; license: string };

async function searchUnsplash(query: string): Promise<StockPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Unsplash ${res.status}`);
  const json = (await res.json()) as { results?: { urls: { regular: string }; links: { html: string }; user: { name: string } }[] };
  return (json.results ?? []).map((r) => ({ url: r.urls.regular, sourceRef: r.links.html, license: `Unsplash · ${r.user.name}` }));
}

async function searchPixabay(query: string): Promise<StockPhoto[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=8&safesearch=true`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const json = (await res.json()) as { hits?: { largeImageURL: string; pageURL: string; user: string }[] };
  return (json.hits ?? []).map((h) => ({ url: h.largeImageURL, sourceRef: h.pageURL, license: `Pixabay · ${h.user}` }));
}

export function hasStockKeys(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY || process.env.PIXABAY_API_KEY);
}

/** Unsplash → Pixabay 순. 이미 쓴 사진(usedRefs)은 건너뛴다. */
export async function searchStockPhoto(query: string, usedRefs: Set<string>): Promise<StockPhoto | null> {
  for (const search of [searchUnsplash, searchPixabay]) {
    try {
      const found = (await search(query)).find((p) => !usedRefs.has(p.sourceRef));
      if (found) return found;
    } catch (e) {
      console.warn("[stock] 검색 실패:", (e as Error).message);
    }
  }
  return null;
}
