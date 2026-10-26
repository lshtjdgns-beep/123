import "server-only";

/** 네이버 검색 자동완성으로 연관 키워드 제안 */
export async function suggestKeywords(q: string): Promise<string[]> {
  const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(q)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`자동완성 ${res.status}`);
  const json = (await res.json()) as { items?: unknown[][] };
  const out: string[] = [];
  for (const group of json.items ?? []) {
    for (const item of group as unknown[]) {
      const text = Array.isArray(item) ? String(item[0]) : String(item);
      if (text && text !== q && !out.includes(text)) out.push(text);
    }
  }
  return out.slice(0, 15);
}
