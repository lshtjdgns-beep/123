// 태그 safety net: 모델이 규칙을 안 지켜도 최종 방어.
//  - 대표키워드·상호명은 반드시 포함(맨 앞)
//  - 모든 태그는 "제목에 실제로 쓰인 단어들의 조합"만 허용
//    (안 그러면 제목에 없는 지명이 태그에 섞여 들어가는 버그 발생)

export const normalizeTag = (t: string) => t.replace(/^#/, "").replace(/\s+/g, "").trim();

function titleWords(title: string): string[] {
  return title
    .replace(/\*\*|__|==/g, "")
    .split(/[\s,.!?·|/\-~:;()[\]"'“”‘’]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** tag를 제목 단어(또는 2자 이상 앞부분 — "맛집에서"의 "맛집")들의 이어붙임으로 만들 수 있는가 */
export function isComposedOfTitleWords(tag: string, title: string): boolean {
  const t = normalizeTag(tag);
  if (!t) return false;
  const words = titleWords(title);
  const pieces = new Set<string>();
  for (const w of words) for (let k = Math.min(w.length, 2); k <= w.length; k++) pieces.add(w.slice(0, k));
  const ok: boolean[] = Array(t.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < t.length; i++) {
    if (!ok[i]) continue;
    for (const p of pieces) if (t.startsWith(p, i)) ok[i + p.length] = true;
  }
  return ok[t.length];
}

export function restrictTagsToTitleWords(tags: string[], title: string, keep: string[] = []): string[] {
  const keepSet = new Set(keep.map(normalizeTag));
  return tags.filter((t) => keepSet.has(normalizeTag(t)) || isComposedOfTitleWords(t, title));
}

export function finalizeTags(tags: string[], opts: { title: string; keyword: string; businessName?: string | null; max?: number }): string[] {
  const forced = [opts.keyword, opts.businessName ?? ""].map(normalizeTag).filter(Boolean);
  const cleaned = restrictTagsToTitleWords(tags.map(normalizeTag).filter(Boolean), opts.title, forced);
  const out: string[] = [];
  for (const t of [...forced, ...cleaned]) if (t && !out.includes(t)) out.push(t);
  return out.slice(0, opts.max ?? 10);
}
