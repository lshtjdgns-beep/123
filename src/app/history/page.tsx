"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/clientFetch";

type HistoryItem = { id: string; draft_id: string; naver_post_url: string | null; published_at: string; success: number; error_message: string | null; title: string; keyword: string };

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<{ history: HistoryItem[] }>("/api/history").then((r) => setItems(r.history)).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => { void load(); }, []);

  // 실패 항목은 같은 draftId로 /api/publish 재호출(리뷰 페이지와 같은 publishDraft 코드)
  async function retry(draftId: string) {
    setBusy(draftId);
    setMsg(null);
    try {
      await api("/api/publish", { method: "POST", json: { draftId, mode: "draft" } });
      setMsg({ ok: true, text: "재시도 성공 — 네이버 임시저장 완료" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      void load();
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">발행 / 임시저장 이력</h1>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-brand/10 text-brand" : "bg-danger/10 text-danger"}`}>{msg.text}</p>}
      {!items && <p className="text-muted">불러오는 중…</p>}
      {items?.length === 0 && <p className="text-muted">아직 이력이 없습니다.</p>}
      <ul className="space-y-2">
        {items?.map((h) => (
          <li key={h.id} className="card flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/draft/${h.draft_id}`} className="block truncate font-medium hover:text-brand">{h.title}</Link>
              <p className="text-xs text-muted">{h.keyword} · {h.published_at}</p>
              {!h.success && <p className="text-xs text-danger">{h.error_message}</p>}
              {h.success && h.naver_post_url && <a href={h.naver_post_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">{h.naver_post_url}</a>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${h.success ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"}`}>{h.success ? "성공" : "실패"}</span>
              {!h.success && <button type="button" className="btn" onClick={() => retry(h.draft_id)} disabled={Boolean(busy)}>{busy === h.draft_id ? "재시도 중…" : "재시도"}</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
