import "server-only";
import { nanoid } from "nanoid";
import type { SQLInputValue } from "node:sqlite";
import { getDb } from "../client";

export type RunStatus = "pending" | "collecting" | "generating" | "sourcing_images" | "ready" | "failed";

export type RunRow = {
  id: string;
  keyword: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  detail: string | null;
};

export function createRun(keyword: string): string {
  const id = nanoid(12);
  getDb().prepare("INSERT INTO runs (id, keyword, status) VALUES (?, ?, 'pending')").run(id, keyword);
  return id;
}

export function getRun(id: string): RunRow | undefined {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
}

export function updateRun(id: string, patch: { status?: RunStatus; detail?: string | null; error?: string | null; finished?: boolean }) {
  const sets: string[] = [];
  const values: SQLInputValue[] = [];
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.detail !== undefined) { sets.push("detail = ?"); values.push(patch.detail); }
  if (patch.error !== undefined) { sets.push("error = ?"); values.push(patch.error); }
  if (patch.finished) sets.push("finished_at = datetime('now')");
  if (!sets.length) return;
  values.push(id);
  getDb().prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function setRunDetail(id: string, detail: string) {
  updateRun(id, { detail });
}

export function listRecentRuns(limit = 20): RunRow[] {
  return getDb().prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit) as RunRow[];
}
