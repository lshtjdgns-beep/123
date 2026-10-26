import "server-only";
import { nanoid } from "nanoid";
import { getDb } from "../client";

export type ImageRow = {
  id: string;
  draft_id: string;
  source_type: "stock" | "ai";
  source_ref: string | null;
  processed_path: string;
  license_info: string | null;
  /** -1 = 리드 이미지, 0..N = N번째 소제목 */
  slot_index: number;
  created_at: string;
};

export function addImage(input: {
  draftId: string; sourceType: "stock" | "ai"; sourceRef?: string | null;
  processedPath: string; licenseInfo?: string | null; slotIndex: number;
}): string {
  const id = nanoid(12);
  getDb().prepare(`INSERT INTO images (id, draft_id, source_type, source_ref, processed_path, license_info, slot_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, input.draftId, input.sourceType, input.sourceRef ?? null,
    input.processedPath, input.licenseInfo ?? null, input.slotIndex);
  return id;
}

export function getImage(id: string): ImageRow | undefined {
  return getDb().prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
}

export function listImagesForDraft(draftId: string): ImageRow[] {
  return getDb().prepare("SELECT * FROM images WHERE draft_id = ? ORDER BY slot_index, created_at").all(draftId) as ImageRow[];
}
