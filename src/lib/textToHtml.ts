// ContentBlock <-> HTML <-> plain text 변환.
// 서버(생성/발행)와 클라이언트(편집/미리보기) 양쪽에서 쓰므로 server-only 금지.
//
// 본문 문단 텍스트 안의 강조 마커:  **굵게**  __밑줄__  ==노란 하이라이트==

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "toc"; items: string[] }
  | { type: "photoQuote"; text: string };

// ---------- plain text (편집 탭 / 모델 출력 형식) ----------

const TABLE_OPEN = "[[TABLE]]";
const TABLE_CLOSE = "[[/TABLE]]";
const TOC_OPEN = "[[목차]]";
const TOC_CLOSE = "[[/목차]]";
const PHOTO_OPEN = "[[사진텍스트]]";
const PHOTO_CLOSE = "[[/사진텍스트]]";
const HEADING_RE = /^\[\[H\]\]([\s\S]*?)\[\[\/H\]\]$/;

function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function plainTextToBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const collectUntil = (close: string): string[] => {
    const out: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== close) {
      out.push(lines[i]);
      i++;
    }
    i++; // close 줄 건너뜀(없으면 끝까지)
    return out;
  };
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line === TABLE_OPEN) {
      const rows = collectUntil(TABLE_CLOSE)
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseTableRow)
        .filter((r) => !isMarkdownSeparatorRow(r));
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    if (line === TOC_OPEN) {
      const items = collectUntil(TOC_CLOSE).map((l) => l.trim()).filter(Boolean);
      if (items.length) blocks.push({ type: "toc", items });
      continue;
    }
    if (line === PHOTO_OPEN) {
      const body = collectUntil(PHOTO_CLOSE).map((l) => l.trim()).filter(Boolean);
      if (body.length) blocks.push({ type: "photoQuote", text: body.join("\n") });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      const t = h[1].trim();
      if (t) blocks.push({ type: "heading", text: t });
      i++;
      continue;
    }
    blocks.push({ type: "paragraph", text: line });
    i++;
  }
  return blocks;
}

export function blocksToPlainText(blocks: ContentBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph": out.push(b.text); break;
      case "heading": out.push("", `[[H]]${b.text}[[/H]]`); break;
      case "table": out.push(TABLE_OPEN, ...b.rows.map((r) => r.join(" | ")), TABLE_CLOSE); break;
      case "toc": out.push(TOC_OPEN, ...b.items, TOC_CLOSE); break;
      case "photoQuote": out.push(PHOTO_OPEN, ...b.text.split("\n"), PHOTO_CLOSE); break;
    }
  }
  return out.join("\n").replace(/^\n+/, "");
}

// ---------- HTML (DB 저장 형식) ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** 강조 마커 → 인라인 HTML. 같은 마커가 짝이 안 맞으면 남은 건 그냥 닫아준다. */
export function markersToHtml(text: string): string {
  const tags: Record<string, [string, string]> = {
    "**": ["<strong>", "</strong>"],
    "__": ["<u>", "</u>"],
    "==": ['<mark style="background:#fff593">', "</mark>"],
  };
  const open: string[] = [];
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two in tags) {
      const idx = open.lastIndexOf(two);
      if (idx >= 0) {
        // 닫기: 안쪽에 열린 다른 태그들을 닫았다가 다시 연다
        const inner = open.splice(idx);
        for (let k = inner.length - 1; k >= 0; k--) out += tags[inner[k]][1];
        for (let k = 1; k < inner.length; k++) { out += tags[inner[k]][0]; open.push(inner[k]); }
      } else {
        open.push(two);
        out += tags[two][0];
      }
      i += 2;
      continue;
    }
    out += escapeHtml(text[i]);
    i++;
  }
  for (let k = open.length - 1; k >= 0; k--) out += tags[open[k]][1];
  return out;
}

/** 인라인 HTML → 강조 마커 */
export function htmlToMarkers(html: string): string {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?(strong|b)(\s[^>]*)?>/gi, "**")
      .replace(/<\/?u(\s[^>]*)?>/gi, "__")
      .replace(/<\/?mark(\s[^>]*)?>/gi, "==")
      .replace(/<[^>]+>/g, ""),
  );
}

export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "paragraph": return `<p>${markersToHtml(b.text)}</p>`;
        case "heading": return `<h3>${escapeHtml(b.text)}</h3>`;
        case "table":
          return `<table>${b.rows
            .map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${markersToHtml(c)}</th>` : `<td>${markersToHtml(c)}</td>`)).join("")}</tr>`)
            .join("")}</table>`;
        case "toc": return `<div data-block="toc">${b.items.map((it) => `<p>${markersToHtml(it)}</p>`).join("")}</div>`;
        case "photoQuote": return `<div data-block="photo">${b.text.split("\n").map((l) => `<p>${markersToHtml(l)}</p>`).join("")}</div>`;
      }
    })
    .join("\n");
}

export function htmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const re = /<h3>([\s\S]*?)<\/h3>|<table>([\s\S]*?)<\/table>|<div data-block="(toc|photo)">([\s\S]*?)<\/div>|<p>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  const innerParas = (s: string) => [...s.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => htmlToMarkers(x[1]).trim()).filter(Boolean);
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const t = htmlToMarkers(m[1]).replace(/\*\*|__|==/g, "").trim();
      if (t) blocks.push({ type: "heading", text: t });
    } else if (m[2] !== undefined) {
      const rows = [...m[2].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
        [...r[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map((c) => htmlToMarkers(c[1]).trim()),
      );
      if (rows.length) blocks.push({ type: "table", rows });
    } else if (m[3] !== undefined) {
      const items = innerParas(m[4]);
      if (!items.length) continue;
      if (m[3] === "toc") blocks.push({ type: "toc", items });
      else blocks.push({ type: "photoQuote", text: items.join("\n") });
    } else if (m[5] !== undefined) {
      const t = htmlToMarkers(m[5]).trim();
      if (t) blocks.push({ type: "paragraph", text: t });
    }
  }
  return blocks;
}

/**
 * 정보 라벨 문단: 문단 전체가 짧은 **굵게** 한 덩어리("**주차**", "**영업시간**").
 * 섹션 안에서 주차·예약·영업시간 같은 항목 이름을 굵게 표시하는 용도라 강조 횟수에 세지 않는다.
 */
export function isLabelParagraph(text: string): boolean {
  return /^\*\*[^*\n]{1,15}\*\*$/.test(text.trim());
}

export function stripMarkers(s: string): string {
  return s.replace(/\*\*|__|==/g, "");
}

/** 블록 전체를 화면에 보이는 텍스트로(글자수/키워드 카운트용) */
export function blocksToVisibleText(blocks: ContentBlock[], opts: { includeToc?: boolean; includePhotoQuote?: boolean } = {}): string {
  const { includeToc = true, includePhotoQuote = true } = opts;
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") parts.push(stripMarkers(b.text));
    else if (b.type === "table") parts.push(b.rows.map((r) => r.map(stripMarkers).join(" ")).join("\n"));
    else if (b.type === "toc" && includeToc) parts.push(b.items.map(stripMarkers).join("\n"));
    else if (b.type === "photoQuote" && includePhotoQuote) parts.push(stripMarkers(b.text));
  }
  return parts.join("\n");
}
