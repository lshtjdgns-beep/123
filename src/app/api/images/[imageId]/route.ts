import fs from "node:fs";
import path from "node:path";
import { getImage } from "@/server/db/repositories/images";
import { PROCESSED_DIR } from "@/lib/paths";

export async function GET(_req: Request, ctx: RouteContext<"/api/images/[imageId]">) {
  const { imageId } = await ctx.params;
  const img = getImage(imageId);
  if (!img) return new Response("not found", { status: 404 });
  const file = path.resolve(img.processed_path);
  if (!file.startsWith(path.resolve(PROCESSED_DIR)) || !fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
