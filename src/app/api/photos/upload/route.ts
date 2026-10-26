import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { UPLOADS_DIR } from "@/lib/paths";
import { jsonError } from "@/server/http";

const ALLOWED = /\.(jpe?g|png|webp|heic|heif|gif)$/i;

/** multipart "files" 필드. 파일 이름(토큰)만 돌려주고, /api/run이 업로드 폴더 안에서만 찾는다. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (!files.length) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const saved: { name: string; original: string; size: number }[] = [];
    for (const f of files) {
      const ext = (path.extname(f.name) || ".jpg").toLowerCase();
      if (!ALLOWED.test(ext)) continue;
      const name = `${Date.now()}-${nanoid(8)}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, name), Buffer.from(await f.arrayBuffer()));
      saved.push({ name, original: f.name, size: f.size });
    }
    return NextResponse.json({ files: saved });
  } catch (e) {
    return jsonError(e);
  }
}
