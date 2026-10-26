import "server-only";
import { generateText } from "../ai/claudeClient";

export type EndingStats = {
  formal: number;
  polite: number;
  plain: number;
  laughOrCry: number;
  tilde: number;
  exclamation: number;
  question: number;
};

export type StyleProfile = {
  blogId: string;
  builtAt: string;
  postsUsed: number;
  titles: string[];
  endingStats: EndingStats;
  toneSummary: string | null;
  /** draftPrompt에 그대로 삽입할 문자열 */
  promptFragment: string;
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。]|요|다|죠)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

const ratio = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 1000 : 0);

/**
 * 종결어미 통계. ⚠ ㅎㅎ/ㅋㅋ/ㅠㅠ와 물결(~)은 "문장 끝 매칭"이 아니라 전체 텍스트에서
 * 등장 횟수를 세서 (등장 수 / 총 문장 수)로 계산한다. 문장 분리기가 "요 " 뒤에서 자르기
 * 때문에 "~해요 ㅎㅎ"의 "ㅎㅎ"가 다음 조각 맨 앞으로 넘어가서, 문장 끝 매칭으로는 항상
 * 0%가 나오는 버그가 실제로 있었다.
 */
export function computeEndingStats(texts: string[]): EndingStats {
  const allText = texts.join("\n");
  const sentences = texts.flatMap(splitSentences);
  const total = sentences.length;
  const strip = (s: string) => s.replace(/[\s.!?~ㅎㅋㅠㅜ^♡♥😊😂🤣]+$/u, "");
  let formal = 0, polite = 0, plain = 0, exclamation = 0, question = 0;
  for (const s of sentences) {
    const core = strip(s);
    if (/(습니다|입니다|합니다|습니까|니다)$/.test(core)) formal++;
    else if (/(요|죠|네요|어요|아요|에요|예요)$/.test(core)) polite++;
    else if (/(했다|였다|이다|한다|된다|있다|없다)$/.test(core)) plain++;
    if (/!\s*$/.test(s)) exclamation++;
    if (/\?\s*$/.test(s)) question++;
  }
  const laugh = allText.match(/[ㅎㅋㅠ]{2,}/g)?.length ?? 0;
  const tilde = allText.match(/[가-힣a-zA-Z0-9)!?]~+/g)?.length ?? 0;
  return {
    formal: ratio(formal, total),
    polite: ratio(polite, total),
    plain: ratio(plain, total),
    laughOrCry: ratio(laugh, total),
    tilde: ratio(tilde, total),
    exclamation: ratio(exclamation, total),
    question: ratio(question, total),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatEndingStats(s: EndingStats): string {
  return `합니다체 ${pct(s.formal)}, 해요체 ${pct(s.polite)}, 평서(~다) ${pct(s.plain)}, ㅎㅎ/ㅋㅋ/ㅠㅠ ${pct(s.laughOrCry)}, 물결(~) ${pct(s.tilde)}, 느낌표 ${pct(s.exclamation)}, 물음표 ${pct(s.question)}`;
}

export async function summarizeTone(posts: { title: string; text: string }[]): Promise<string> {
  const body = posts.map((p, i) => `### 글 ${i + 1}: ${p.title}\n${p.text.slice(0, 2200)}`).join("\n\n");
  const prompt = `아래는 한 블로거가 최근에 쓴 글 ${posts.length}개입니다. 글의 "내용"이 아니라 "말하는 방식"만 분석하세요.

${body}

다음 항목을 6~9개의 불릿(- 로 시작)으로만 답하세요. 다른 설명은 쓰지 마세요.
- 주로 쓰는 종결어미
- 독자를 부르는 호칭
- 자주 쓰는 추임새
- 이모지 / ㅎㅎ / ㅋㅋ / 물결(~) 습관
- 문장 길이와 리듬
- 문단을 나누는 방식
- 도입부 / 마무리 패턴
- 실제로 자주 쓰는 표현 예시 3~5개(원문 그대로 짧게)`;
  return (await generateText(prompt, { lightweight: true })).trim();
}

export function buildPromptFragment(stats: EndingStats, toneSummary: string | null, titles: string[]): string {
  return [
    `[내 블로그 말투 분석 — 최근 글 ${titles.length}개 기준]`,
    `종결어미/습관 비율(문장 수 대비): ${formatEndingStats(stats)}`,
    "→ 위 비율과 비슷하게 섞어 쓰세요(예: ㅎㅎ가 12%면 문장 열 개 중 한두 개 정도).",
    toneSummary ? `\n말투 특징:\n${toneSummary}` : "",
  ].filter(Boolean).join("\n");
}
