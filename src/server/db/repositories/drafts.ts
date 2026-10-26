import "server-only";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import type { DraftReport } from "@/lib/reportTypes";

export type DraftStatus = "draft" | "edited" | "published" | "discarded";

type DraftDbRow = {
  id: string;
  run_id: string;
  keyword: string;
  title: string;
  body_html: string;
  status: DraftStatus;
  style_profile_id: string | null;
  source_ids_json: string;
  image_ids_json: string;
  tags_json: string;
  places_json: string;
  business_name: string | null;
  report_json: string | null;
  created_at: string;
  updated_at: string;
};

export type Draft = {
  id: string;
  runId: string;
  keyword: string;
  title: string;
  bodyHtml: string;
  status: DraftStatus;
  styleProfileId: string | null;
  sourceIds: string[];
  imageIds: string[];
  tags: string[];
  places: string[];
  businessName: string | null;
  report: DraftReport | null;
  createdAt: string;
  updatedAt: string;
};

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function toDraft(r: DraftDbRow): Draft {
  return {
    id: r.id,
    runId: r.run_id,
    keyword: r.keyword,
    title: r.title,
    bodyHtml: r.body_html,
    status: r.status,
    styleProfileId: r.style_profile_id,
    sourceIds: parseJson(r.source_ids_json, []),
    imageIds: parseJson(r.image_ids_json, []),
    tags: parseJson(r.tags_json, []),
    places: parseJson(r.places_json, []),
    businessName: r.business_name,
    report: parseJson<DraftReport | null>(r.report_json, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createDraft(input: {
  runId: string; keyword: string; title: string; bodyHtml: string;
  styleProfileId?: string | null; sourceIds?: string[]; tags?: string[]; places?: string[];
  businessName?: string | null; report?: DraftReport | null;
}): string {
  const id = nanoid(12);
  getDb().prepare(`INSERT INTO drafts
    (id, run_id, keyword, title, body_html, style_profile_id, source_ids_json, tags_json, places_json, business_name, report_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.runId, input.keyword, input.title, input.bodyHtml, input.styleProfileId ?? null,
    JSON.stringify(input.sourceIds ?? []), JSON.stringify(input.tags ?? []), JSON.stringify(input.places ?? []),
    input.businessName ?? null, input.report ? JSON.stringify(input.report) : null,
  );
  return id;
}

export function getDraft(id: string): Draft | undefined {
  const r = getDb().prepare("SELECT * FROM drafts WHERE id = ?").get(id) as DraftDbRow | undefined;
  return r ? toDraft(r) : undefined;
}

export function getDraftByRun(runId: string): Draft | undefined {
  const r = getDb().prepare("SELECT * FROM drafts WHERE run_id = ? ORDER BY created_at DESC LIMIT 1").get(runId) as DraftDbRow | undefined;
  return r ? toDraft(r) : undefined;
}

export function updateDraft(id: string, patch: Partial<{
  title: string; bodyHtml: string; status: DraftStatus; tags: string[]; places: string[];
  imageIds: string[]; report: DraftReport | null;
}>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) { sets.push("title = ?"); values.push(patch.title); }
  if (patch.bodyHtml !== undefined) { sets.push("body_html = ?"); values.push(patch.bodyHtml); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.tags !== undefined) { sets.push("tags_json = ?"); values.push(JSON.stringify(patch.tags)); }
  if (patch.places !== undefined) { sets.push("places_json = ?"); values.push(JSON.stringify(patch.places)); }
  if (patch.imageIds !== undefined) { sets.push("image_ids_json = ?"); values.push(JSON.stringify(patch.imageIds)); }
  if (patch.report !== undefined) { sets.push("report_json = ?"); values.push(patch.report ? JSON.stringify(patch.report) : null); }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE drafts SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function listDrafts(limit = 50): Draft[] {
  return (getDb().prepare("SELECT * FROM drafts ORDER BY created_at DESC LIMIT ?").all(limit) as DraftDbRow[]).map(toDraft);
}
