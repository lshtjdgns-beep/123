import "server-only";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { PROCESSED_DIR } from "@/lib/paths";

/** 업로드용 정규화: EXIF 방향 적용 후 제거, 최대 1200px, JPEG */
export async function processImage(input: string | Buffer): Promise<string> {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const out = path.join(PROCESSED_DIR, `${nanoid(12)}.jpg`);
  await sharp(input)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(out);
  return out;
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
