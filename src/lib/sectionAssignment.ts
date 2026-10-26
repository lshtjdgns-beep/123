// 블록을 "도입부 + 소제목 섹션들"로 나누고, 섹션별 강조 문장(사진 캡션 후보)을 찾는다.
// 서버(발행)와 클라이언트(미리보기) 공용 — server-only 금지.
import type { ContentBlock } from "./textToHtml";

export type Section = { heading: string | null; blocks: ContentBlock[] };

/** sections[0]은 도입부(heading=null), 이후는 소제목 순서대로 */
export function splitIntoSections(blocks: ContentBlock[]): Section[] {
  const sections: Section[] = [{ heading: null, blocks: [] }];
  for (const b of blocks) {
    if (b.type === "heading") sections.push({ heading: b.text, blocks: [] });
    else sections[sections.length - 1].blocks.push(b);
  }
  return sections;
}

/** 섹션 안에서 굵게/밑줄 강조가 들어간 첫 문단(사진 캡션으로 재사용) */
export function findSectionCaption(section: Section): string | null {
  for (const b of section.blocks) {
    if (b.type === "paragraph" && /\*\*[^*]+\*\*|__[^_]+__/.test(b.text)) return b.text;
  }
  return null;
}

/** 소제목 섹션별 캡션 목록(index = 소제목 번호) */
export function sectionCaptions(blocks: ContentBlock[]): (string | null)[] {
  return splitIntoSections(blocks).slice(1).map(findSectionCaption);
}

/** 캡션으로 쓴 문장은 본문 원래 위치에서 제거(중복 방지) */
export function removeFirstMatchingParagraph(blocks: ContentBlock[], text: string): ContentBlock[] {
  let removed = false;
  return blocks.filter((b) => {
    if (!removed && b.type === "paragraph" && b.text === text) {
      removed = true;
      return false;
    }
    return true;
  });
}
