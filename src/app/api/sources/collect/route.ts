import { NextResponse } from "next/server";
import { z } from "zod";
import { collectSources } from "@/server/naver/searchScraper";
import { saveSources } from "@/server/db/repositories/sources";
import { jsonError } from "@/server/http";

const Body = z.object({ keyword: z.string().trim().min(1) });

export async function POST(req: Request) {
  try {
    const { keyword } = Body.parse(await req.json());
    const sources = await collectSources(keyword);
    const ids = saveSources(keyword, sources);
    return NextResponse.json({ sources: sources.map((s, i) => ({ ...s, id: ids[i] })) });
  } catch (e) {
    return jsonError(e);
  }
}
