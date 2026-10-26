import "server-only";
import { extractJson, generateText } from "../ai/claudeClient";

/** 소제목들을 스톡사진 검색용 영어 키워드로(한 번의 호출로 전부) */
export async function translateQueries(texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const prompt = `다음 한국어 블로그 소제목 각각을 스톡 사진 검색에 쓸 영어 키워드(2~4단어, 사진으로 찍을 수 있는 구체적인 사물/장면)로 바꾸세요.
JSON 문자열 배열 하나만 출력하세요(입력과 같은 개수, 같은 순서).
${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  try {
    const arr = extractJson<unknown[]>(await generateText(prompt, { lightweight: true }));
    return texts.map((t, i) => (typeof arr[i] === "string" && arr[i] ? String(arr[i]) : t));
  } catch {
    return texts;
  }
}
