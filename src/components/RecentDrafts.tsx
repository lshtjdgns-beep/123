"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/clientFetch";

type DraftItem = { id: string; title: string; keyword: string; status: string; createdAt: string; allPassed: boolean | null };

export default function RecentDrafts() {
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);
  useEffect(() => {
    api<{ drafts: DraftItem[] }>("/api/history").then((r) => setDrafts(r.drafts.slice(0, 10))).catch(() => setDrafts([]));
  }, []);
  return (
    <section className="card">
      <h2 className="mb-2 text-lg font-bold">최근 초안</h2>
      {!drafts && <p className="text-sm text-muted">불러오는 중…</p>}
      {drafts?.length === 0 && <p className="text-sm text-muted">아직 만든 초안이 없습니다.</p>}
      <ul className="divide-y divide-line">
        {drafts?.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <Link href={`/draft/${d.id}`} className="truncate hover:text-brand">{d.title}</Link>
            <span className="shrink-0 text-xs text-muted">
              {d.allPassed === false ? "미충족 있음 · " : ""}{d.keyword} · {d.createdAt.slice(0, 16)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
