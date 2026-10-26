import "server-only";
import sharp from "sharp";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 긴 소제목을 카드 폭에 맞게 2~3줄로 */
function wrap(text: string, max = 14): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

const PALETTES = [
  { bg: "#fdf6e3", accent: "#e0a800", fg: "#3a3a3a" },
  { bg: "#eef6f1", accent: "#2f9e6e", fg: "#24382f" },
  { bg: "#eef3fb", accent: "#3b6fd8", fg: "#22314d" },
  { bg: "#fbefef", accent: "#d9534f", fg: "#432626" },
];

/** 소제목 요약 카드 이미지(PNG 버퍼) */
export async function renderSectionCard(heading: string, index: number, subtitle?: string): Promise<Buffer> {
  const p = PALETTES[index % PALETTES.length];
  const lines = wrap(heading);
  const W = 960, H = 640;
  const lineH = 78;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2 + 10;
  const font = "Malgun Gothic, 'Apple SD Gothic Neo', 'Noto Sans KR', 'NanumGothic', sans-serif";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <rect x="60" y="60" width="${W - 120}" height="${H - 120}" rx="28" fill="#ffffff" stroke="${p.accent}" stroke-width="4"/>
  <text x="${W / 2}" y="140" text-anchor="middle" font-family="${font}" font-size="34" font-weight="700" fill="${p.accent}">POINT ${String(index + 1).padStart(2, "0")}</text>
  ${lines.map((l, i) => `<text x="${W / 2}" y="${startY + i * lineH}" text-anchor="middle" font-family="${font}" font-size="60" font-weight="700" fill="${p.fg}">${escapeXml(l)}</text>`).join("\n  ")}
  ${subtitle ? `<text x="${W / 2}" y="${H - 110}" text-anchor="middle" font-family="${font}" font-size="28" fill="${p.fg}" opacity="0.7">${escapeXml(subtitle.slice(0, 30))}</text>` : ""}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
