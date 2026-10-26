import "server-only";
import sharp from "sharp";
import PQueue from "p-queue";
import { ClaudeAuthError, extractJson, generateFromImage } from "../ai/claudeClient";

export type PhotoAnalysis = {
  path: string;
  description: string;
  suggestedSectionTopic: string;
  /** 줄마다 원소 하나. 메뉴판이면 첫 원소는 **카테고리명** */
  extractedText: string[] | null;
};

const PROMPT = `이 사진은 블로그 글에 첨부할 사진입니다. 아래 JSON 하나만 출력하세요.
{"description": "사진에 실제로 보이는 것만 1~2문장으로", "suggestedSectionTopic": "이 사진이 어울리는 소제목 주제(짧게)", "extractedText": ["줄1", "줄2"] 또는 null}

extractedText 규칙:
- 사진 속에 읽을 수 있는 글자(메뉴판, 안내문, 가격표 등)가 있을 때만 배열로, 없으면 null.
- 배열의 원소 하나가 한 줄입니다(문자열 하나에 줄바꿈을 넣지 마세요).
- 메뉴판이면 첫 원소는 카테고리명을 **굵게** 표시(예: "**세트메뉴**"), 그 다음부터 항목당 하나씩 "메뉴명 - 가격" 형식으로 간단히, 대표 5~6개만.
- 전체를 그대로 옮기지 말고 짧게 요약하세요.
- 사진에 없는 글자를 지어내지 마세요.`;

/**
 * 원본(폰 사진 3000px/3MB+)을 그대로 보내면 모델이 어차피 1568px로 다운샘플한다 — 시간 낭비.
 * .rotate()로 EXIF 방향을 적용하지 않으면 세로 사진이 누워서 글자를 못 읽는다.
 */
async function prepareImage(filePath: string): Promise<string> {
  const buf = await sharp(filePath)
    .rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return buf.toString("base64");
}

/** string[] | string | null 전부 받아서 string[] | null로 정규화(하위호환) */
export function parseAnalysis(raw: unknown, filePath: string): PhotoAnalysis {
  const obj = (raw ?? {}) as { description?: unknown; suggestedSectionTopic?: unknown; extractedText?: unknown };
  let lines: string[] | null = null;
  if (Array.isArray(obj.extractedText)) lines = obj.extractedText.map(String);
  else if (typeof obj.extractedText === "string") lines = obj.extractedText.split(/\\n|\n/);
  lines = lines?.map((l) => l.trim()).filter(Boolean) ?? null;
  return {
    path: filePath,
    description: String(obj.description ?? "").trim(),
    suggestedSectionTopic: String(obj.suggestedSectionTopic ?? "").trim(),
    extractedText: lines && lines.length ? lines.slice(0, 8) : null,
  };
}

export async function analyzePhoto(filePath: string): Promise<PhotoAnalysis> {
  const base64 = await prepareImage(filePath);
  const text = await generateFromImage({ base64, mediaType: "image/jpeg" }, PROMPT, { lightweight: true });
  return parseAnalysis(extractJson(text), filePath);
}

/**
 * ⚠ 첫 장은 단독으로 먼저 처리한 뒤 나머지를 동시 처리(동시성 4).
 * Claude 로그인 토큰 갱신이 여러 서브프로세스에서 동시에 일어나면 서로 충돌해서
 * 저장된 로그인 파일 자체가 지워지는 사고가 실제로 있었다(사진 25장을 한꺼번에
 * 시작하자 몇 분 뒤 로그인 파일이 비어버림). 첫 장이 토큰을 안정시킨 뒤 병렬로 돌린다.
 *
 * ClaudeAuthError는 "한 장 실패"가 아니라 나머지 전부를 즉시 중단시킨다.
 */
export async function analyzePhotos(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: (PhotoAnalysis | null)[]; error: string | null }> {
  const results: (PhotoAnalysis | null)[] = paths.map(() => null);
  if (!paths.length) return { results, error: null };
  let done = 0;
  let authError: ClaudeAuthError | null = null;
  let lastError: string | null = null;

  const runOne = async (i: number) => {
    if (authError) return;
    try {
      results[i] = await analyzePhoto(paths[i]);
    } catch (e) {
      if (e instanceof ClaudeAuthError) {
        authError = e;
        queue.clear();
      } else {
        lastError = (e as Error).message;
        console.warn("[photo] 분석 실패:", paths[i], lastError);
      }
    } finally {
      done++;
      onProgress?.(done, paths.length);
    }
  };

  const queue = new PQueue({ concurrency: 4 });
  await runOne(0);
  if (!authError) {
    for (let i = 1; i < paths.length; i++) queue.add(() => runOne(i));
    await queue.onIdle();
  }
  if (authError) throw authError;
  return { results, error: lastError };
}
