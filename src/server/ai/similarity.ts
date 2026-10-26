// 원본(검색자료·상위노출 글)과 문장을 그대로 베꼈는지 보는 n-gram 유사도.
// 공백을 제거한 글자 N-gram 중 원본에도 있는 비율(0~1).

const N = 8;

function ngrams(text: string, n = N): Set<string> {
  const s = text.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

export function overlapRatio(body: string, source: string): number {
  const b = ngrams(body);
  if (!b.size) return 0;
  const s = ngrams(source);
  let hit = 0;
  for (const g of b) if (s.has(g)) hit++;
  return hit / b.size;
}

export function maxOverlapAgainstSources(body: string, sources: string[]): number | null {
  const usable = sources.filter((s) => s && s.replace(/\s/g, "").length >= 50);
  if (!usable.length) return null;
  return Math.max(...usable.map((s) => overlapRatio(body, s)));
}

