import { NextResponse } from "next/server";
import { z } from "zod";
import { getDraft, updateDraft } from "@/server/db/repositories/drafts";
import { listImagesForDraft } from "@/server/db/repositories/images";
import { getLastSuccessfulPublish } from "@/server/db/repositories/publishedPosts";
import { blocksToHtml, blocksToPlainText, htmlToBlocks, plainTextToBlocks } from "@/lib/textToHtml";
import { jsonError } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/draft/[draftId]">) {
  const { draftId } = await ctx.params;
  const draft = getDraft(draftId);
  if (!draft) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
  const images = listImagesForDraft(draftId).map((i) => ({
    id: i.id, slotIndex: i.slot_index, sourceRef: i.source_ref, license: i.license_info, url: `/api/images/${i.id}`,
  }));
  const last = getLastSuccessfulPublish(draftId);
  return NextResponse.json({ draft, bodyText: blocksToPlainText(htmlToBlocks(draft.bodyHtml)), images, lastSavedAt: last?.published_at ?? null });
}

const Patch = z.object({
  title: z.string().optional(),
  bodyText: z.string().optional(),
  tags: z.array(z.string()).optional(),
  places: z.array(z.string()).optional(),
  status: z.enum(["draft", "edited", "published", "discarded"]).optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/draft/[draftId]">) {
  try {
    const { draftId } = await ctx.params;
    if (!getDraft(draftId)) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    const p = Patch.parse(await req.json());
    updateDraft(draftId, {
      ...(p.title !== undefined ? { title: p.title.trim() } : {}),
      ...(p.bodyText !== undefined ? { bodyHtml: blocksToHtml(plainTextToBlocks(p.bodyText)) } : {}),
      ...(p.tags ? { tags: p.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean) } : {}),
      ...(p.places ? { places: p.places.map((t) => t.trim()).filter(Boolean) } : {}),
      status: p.status ?? "edited",
    });
    return NextResponse.json({ ok: true, draft: getDraft(draftId) });
  } catch (e) {
    return jsonError(e);
  }
}
