import "server-only";
import { addImage } from "../db/repositories/images";
import { updateDraft } from "../db/repositories/drafts";
import { processImage, downloadImage } from "./postProcess";
import { searchStockPhoto, hasStockKeys } from "./stockSearch";
import { generateAiImage, hasAiImageKeys } from "./aiGenerate";
import { renderSectionCard } from "./cardImage";
import { translateQueries } from "./translateQuery";

export type SourceImagesInput = {
  draftId: string;
  keyword: string;
  headings: string[];
  /** 사용자가 업로드한 사진(원본 경로) */
  photoPaths: string[];
  /** 사진 i → 소제목 번호(0부터) 또는 -1 */
  photoSections: number[];
  generateAiPhotos: boolean;
  generateCardImages: boolean;
  onProgress?: (msg: string) => void;
};

export async function sourceImagesForDraft(input: SourceImagesInput): Promise<{ count: number; errors: string[] }> {
  const { draftId, keyword, headings, photoPaths, generateAiPhotos, generateCardImages, onProgress } = input;
  const ids: string[] = [];
  const errors: string[] = [];
  const usedStock = new Set<string>();
  const sectionHasPhoto = headings.map(() => false);

  // 1) 업로드 사진 → 섹션 배정. 모델이 배정 안 한 사진은 사진 없는 섹션부터 채운다.
  const assignment = photoPaths.map((_, i) => {
    const s = input.photoSections[i] ?? -1;
    return s >= 0 && s < headings.length ? s : -1;
  });
  for (const s of assignment) if (s >= 0) sectionHasPhoto[s] = true;
  let rr = 0;
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] >= 0 || !headings.length) continue;
    const empty = sectionHasPhoto.findIndex((x) => !x);
    assignment[i] = empty >= 0 ? empty : rr++ % headings.length;
    sectionHasPhoto[assignment[i]] = true;
  }
  for (let i = 0; i < photoPaths.length; i++) {
    onProgress?.(`첨부 사진 정리 중 (${i + 1}/${photoPaths.length})…`);
    try {
      const out = await processImage(photoPaths[i]);
      ids.push(addImage({ draftId, sourceType: "stock", sourceRef: `upload:${photoPaths[i]}`, processedPath: out, licenseInfo: "사용자 업로드", slotIndex: assignment[i] >= 0 ? assignment[i] : 0 }));
    } catch (e) {
      errors.push(`사진 ${i + 1}: ${(e as Error).message}`);
    }
  }

  // 2) 리드 이미지. ⚠ 업로드 사진이 있으면 첫 장을 리드로도 재사용한다 — 리드(-1 슬롯)는
  //    별도 로직이라 "AI 이미지 끄기"를 걸어도 리드만 계속 AI로 채워지는 구멍이 있었다.
  onProgress?.("리드 이미지 준비 중…");
  try {
    let leadDone = false;
    if (photoPaths.length) {
      const out = await processImage(photoPaths[0]);
      ids.push(addImage({ draftId, sourceType: "stock", sourceRef: `upload:${photoPaths[0]}`, processedPath: out, licenseInfo: "사용자 업로드", slotIndex: -1 }));
      leadDone = true;
    }
    const [leadQuery, ...headingQueries] = !leadDone || headings.some((_, i) => !sectionHasPhoto[i])
      ? await translateQueries([keyword, ...headings])
      : [keyword, ...headings];
    if (!leadDone && hasStockKeys()) {
      const stock = await searchStockPhoto(leadQuery, usedStock);
      if (stock) {
        usedStock.add(stock.sourceRef);
        const out = await processImage(await downloadImage(stock.url));
        ids.push(addImage({ draftId, sourceType: "stock", sourceRef: stock.sourceRef, processedPath: out, licenseInfo: stock.license, slotIndex: -1 }));
        leadDone = true;
      }
    }
    if (!leadDone && generateAiPhotos && hasAiImageKeys()) {
      const ai = await generateAiImage(leadQuery);
      if (ai) {
        ids.push(addImage({ draftId, sourceType: "ai", sourceRef: `ai:${ai.provider}`, processedPath: await processImage(ai.buffer), licenseInfo: `AI 생성(${ai.provider})`, slotIndex: -1 }));
      }
    }

    // 3) 사진 없는 섹션 → 스톡 → (허용 시) AI
    for (let s = 0; s < headings.length; s++) {
      if (sectionHasPhoto[s]) continue;
      onProgress?.(`소제목 사진 찾는 중 (${s + 1}/${headings.length})…`);
      try {
        const q = headingQueries[s] ?? headings[s];
        const stock = hasStockKeys() ? await searchStockPhoto(q, usedStock) : null;
        if (stock) {
          usedStock.add(stock.sourceRef);
          ids.push(addImage({ draftId, sourceType: "stock", sourceRef: stock.sourceRef, processedPath: await processImage(await downloadImage(stock.url)), licenseInfo: stock.license, slotIndex: s }));
          continue;
        }
        if (generateAiPhotos && hasAiImageKeys()) {
          const ai = await generateAiImage(q);
          if (ai) ids.push(addImage({ draftId, sourceType: "ai", sourceRef: `ai:${ai.provider}`, processedPath: await processImage(ai.buffer), licenseInfo: `AI 생성(${ai.provider})`, slotIndex: s }));
        }
      } catch (e) {
        errors.push(`소제목 ${s + 1} 사진: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push(`이미지 소싱: ${(e as Error).message}`);
  }

  // 4) 소제목 요약 카드 이미지(섹션 "추가" 이미지)
  if (generateCardImages) {
    for (let s = 0; s < headings.length; s++) {
      onProgress?.(`소제목 카드 이미지 만드는 중 (${s + 1}/${headings.length})…`);
      try {
        const out = await processImage(await renderSectionCard(headings[s], s, keyword));
        ids.push(addImage({ draftId, sourceType: "ai", sourceRef: `card:${s}`, processedPath: out, licenseInfo: "자동 생성 카드", slotIndex: s }));
      } catch (e) {
        errors.push(`카드 ${s + 1}: ${(e as Error).message}`);
      }
    }
  }

  updateDraft(draftId, { imageIds: ids });
  return { count: ids.length, errors };
}
