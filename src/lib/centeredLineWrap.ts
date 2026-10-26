// 한 문단을 8~15자 정도의 짧은 줄 여러 개로 쪼개 가운데 정렬하는 스타일.
// 상위노출 분석과 무관한 고정 사양이다.
//
// ⚠ server-only 마킹 금지 — Playwright 타이핑(서버)과 미리보기(클라이언트)가
//   같은 함수를 써야 미리보기가 실제 발행 결과와 어긋나지 않는다.
//
// 설계 원칙(직접 문자 개수로 자르면 아래 버그가 전부 재현된다):
//  1. 토큰 경계는 "공백"으로만 정한다. 강조 마커에 공백 없이 붙은 글자는 같은 토큰이다.
//     (`**...있었**던` 의 "던"은 "있었"과 같은 단어. 마커 경계에서 자르면
//      원문에 없던 공백이 생기거나 단어 중간에서 줄이 바뀐다.)
//  2. 그리디로 15자까지 채우되, 쉼표로 끝나는 토큰 뒤에서는 여유가 있어도 줄을 바꾼다.
//  3. 15자를 넘는 "단어 하나"만 글자 단위로 자른다. 긴 강조구는 1번 덕분에 이미 단어로
//     나뉘어 있으므로 "100%"가 "1"/"00%"로 쪼개지는 일이 없다. 여러 줄로 나뉜 강조구는
//     줄마다 마커를 다시 씌운다(타이핑할 때 줄마다 독립적으로 굵게 켜고 끄기 때문).
//  4. visibleLength: 마커(**, __, ==)는 화면에 안 보이므로 길이에서 제외.

export const MAX_LINE = 15;
export const MIN_LINE = 8;

export type Mark = "bold" | "underline" | "highlight";
const MARKERS: Record<string, Mark> = { "**": "bold", "__": "underline", "==": "highlight" };
const MARK_ORDER: Mark[] = ["bold", "underline", "highlight"];
const MARK_TOKEN: Record<Mark, string> = { bold: "**", underline: "__", highlight: "==" };

/** 같은 강조 상태가 이어지는 텍스트 조각 */
export type Run = { text: string; marks: Mark[] };

type Ch = { ch: string; marks: Set<Mark> };

export function visibleLength(s: string): number {
  return [...s.replace(/\*\*|__|==/g, "")].length;
}

/** 마커 문자열을 글자 단위(+강조 상태)로 풀기. 짝 안 맞는 마커는 문단 끝에서 자동으로 닫힘. */
function toChars(text: string): Ch[] {
  const active = new Set<Mark>();
  const out: Ch[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const two = chars[i] + (chars[i + 1] ?? "");
    const mark = MARKERS[two];
    if (mark) {
      if (active.has(mark)) active.delete(mark);
      else active.add(mark);
      i++;
      continue;
    }
    out.push({ ch: chars[i], marks: new Set(active) });
  }
  return out;
}

function sameMarks(a: Set<Mark>, b: Set<Mark>): boolean {
  if (a.size !== b.size) return false;
  for (const m of a) if (!b.has(m)) return false;
  return true;
}

function intersect(a: Set<Mark>, b: Set<Mark>): Set<Mark> {
  return new Set([...a].filter((m) => b.has(m)));
}

/** 글자열 → 강조 상태별 Run 목록 */
function charsToRuns(chars: Ch[]): Run[] {
  const runs: { text: string; marks: Set<Mark> }[] = [];
  for (const c of chars) {
    const last = runs[runs.length - 1];
    if (last && sameMarks(last.marks, c.marks)) last.text += c.ch;
    else runs.push({ text: c.ch, marks: new Set(c.marks) });
  }
  return runs.map((r) => ({ text: r.text, marks: MARK_ORDER.filter((m) => r.marks.has(m)) }));
}

function runsToMarked(runs: Run[]): string {
  return runs
    .map((r) => {
      const open = r.marks.map((m) => MARK_TOKEN[m]).join("");
      const close = [...r.marks].reverse().map((m) => MARK_TOKEN[m]).join("");
      return open + r.text + close;
    })
    .join("");
}

/** 마커 문자열을 Run 목록으로(타이핑/미리보기 렌더링용) */
export function parseMarkedRuns(text: string): Run[] {
  return charsToRuns(toChars(text));
}

type Token = Ch[];

function tokenize(chars: Ch[]): Token[] {
  const tokens: Token[] = [];
  let cur: Token = [];
  for (const c of chars) {
    if (/\s/.test(c.ch)) {
      if (cur.length) tokens.push(cur);
      cur = [];
    } else {
      cur.push(c);
    }
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}

/** 줄(토큰 목록)을 다시 하나의 글자열로. 토큰 사이 공백은 양쪽 공통 강조를 물려받는다. */
function joinLine(tokens: Token[]): Ch[] {
  const out: Ch[] = [];
  tokens.forEach((t, i) => {
    if (i > 0) {
      const prev = tokens[i - 1][tokens[i - 1].length - 1];
      out.push({ ch: " ", marks: intersect(prev.marks, t[0].marks) });
    }
    out.push(...t);
  });
  return out;
}

const lineLen = (tokens: Token[]) => tokens.reduce((n, t) => n + t.length, 0) + Math.max(0, tokens.length - 1);
const endsWithComma = (t: Token) => /[,，、]$/.test(t[t.length - 1].ch);

function hardSplit(token: Token, max: number): Token[] {
  const parts: Token[] = [];
  for (let i = 0; i < token.length; i += max) parts.push(token.slice(i, i + max));
  return parts;
}

/**
 * 문단 하나를 줄 목록(마커 포함 문자열)으로 나눈다.
 * 각 줄은 마커가 줄 안에서 완결된다(줄마다 독립적으로 강조를 켜고 끔).
 */
export function wrapIntoCenteredLines(text: string, max = MAX_LINE): string[] {
  return wrapIntoRunLines(text, max).map(runsToMarked);
}

/** wrapIntoCenteredLines와 같지만 줄마다 Run 목록을 돌려준다. */
export function wrapIntoRunLines(text: string, max = MAX_LINE): Run[][] {
  const tokens = tokenize(toChars(text)).flatMap((t) => (t.length > max ? hardSplit(t, max) : [t]));
  const lines: Token[][] = [];
  let cur: Token[] = [];
  const flush = () => {
    if (cur.length) lines.push(cur);
    cur = [];
  };
  for (const t of tokens) {
    if (cur.length && lineLen([...cur, t]) > max) flush();
    cur.push(t);
    // 쉼표는 읽을 때 자연스럽게 쉬는 지점 — 자리가 남아도 줄을 바꾼다
    if (endsWithComma(t)) flush();
  }
  flush();

  // 마지막 줄이 너무 짧으면(예: "요.") 앞 줄 끝 단어를 내려서 균형을 맞춘다.
  // 앞 줄이 쉼표로 끝났으면 그 줄바꿈은 의도된 것이므로 건드리지 않는다.
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const prev = lines[lines.length - 2];
    while (
      lineLen(last) < 5 &&
      prev.length > 1 &&
      !endsWithComma(prev[prev.length - 1]) &&
      lineLen(prev.slice(0, -1)) >= MIN_LINE &&
      lineLen([prev[prev.length - 1], ...last]) <= max &&
      lineLen([prev[prev.length - 1], ...last]) < lineLen(prev)
    ) {
      last.unshift(prev.pop()!);
    }
  }
  return lines.map((l) => charsToRuns(joinLine(l)));
}
