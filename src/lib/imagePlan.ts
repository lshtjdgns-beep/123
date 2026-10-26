// 이미지 배치 계획 — 발행(서버)과 미리보기(클라이언트)가 같은 규칙을 쓴다.
//  - slot -1: 리드 이미지(제목 바로 다음, 본문 첫 글자 전)
//  - slot N: N번째 소제목. 첫 번째 "사진"(업로드 > 스톡/AI)이 소제목 바로 아래 메인,
//    나머지(카드 이미지, 추가 업로드 사진)는 섹션 안에 2~3문장마다 흩뿌리는 "추가" 이미지.

export type PlannableImage = { id: string; slotIndex: number; sourceRef: string | null };

export type ImagePlan<T extends PlannableImage> = {
  lead: T | null;
  sectionMain: (T | null)[];
  sectionExtras: T[][];
};

export const isCardImage = (img: PlannableImage) => Boolean(img.sourceRef?.startsWith("card:"));
export const isUploadImage = (img: PlannableImage) => Boolean(img.sourceRef?.startsWith("upload:"));

export function planImages<T extends PlannableImage>(images: T[], headingCount: number): ImagePlan<T> {
  const lead = images.find((i) => i.slotIndex === -1) ?? null;
  const sectionMain: (T | null)[] = [];
  const sectionExtras: T[][] = [];
  for (let s = 0; s < headingCount; s++) {
    const inSlot = images.filter((i) => i.slotIndex === s);
    const photos = inSlot.filter((i) => !isCardImage(i));
    // 업로드 사진이 있으면 그게 메인, 없으면 스톡/AI
    const main = photos.find(isUploadImage) ?? photos[0] ?? null;
    sectionMain.push(main);
    sectionExtras.push(inSlot.filter((i) => i !== main));
  }
  return { lead, sectionMain, sectionExtras };
}

/** 추가 이미지 간격: 문장 2~3개마다 하나(랜덤). 미리보기는 고정 2를 쓴다. */
export const randomExtraGap = () => (Math.random() < 0.5 ? 2 : 3);
