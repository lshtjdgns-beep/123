"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/clientFetch";
import type { DraftReport, VerificationCheck } from "@/lib/reportTypes";
import DraftPreview, { type PreviewImage } from "./DraftPreview";
import GenerationReport, { CheckList } from "./GenerationReport";

type DraftResponse = {
  draft: { id: string; title: string; keyword: string; status: string; tags: string[]; places: string[]; businessName: string | null; report: DraftReport | null };
  bodyText: string;
  images: PreviewImage[];
};

type Tab = "edit" | "preview" | "checks" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "edit", label: "편집" },
  { id: "preview", label: "미리보기" },
  { id: "checks", label: "체크리스트" },
  { id: "report", label: "생성 리포트" },
];

export default function DraftEditor({ draftId }: { draftId: string }) {
  const [data, setData] = useState<DraftResponse | null>(null);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [tags, setTags] = useState("");
  const [places, setPlaces] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [checks, setChecks] = useState<VerificationCheck[] | null>(null);
  const [session, setSession] = useState<{ valid: boolean; blogId: string | null; reason?: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const d = await api<DraftResponse>(`/api/draft/${draftId}`);
    setData(d);
    setTitle(d.draft.title);
    setBodyText(d.bodyText);
    setTags(d.draft.tags.join(", "));
    setPlaces(d.draft.places.join(", "));
    setDirty(false);
  }, [draftId]);

  const loadChecks = useCallback(async () => {
    try {
      setChecks((await api<{ checks: VerificationCheck[] }>(`/api/draft/${draftId}/seo-check`)).checks);
    } catch { /* 표시만 생략 */ }
  }, [draftId]);

  useEffect(() => {
    queueMicrotask(() => {
      load().catch((e) => setMessage({ ok: false, text: (e as Error).message }));
      void loadChecks();
    });
    // 발행을 시도하고서야 로그인 만료를 아는 대신, 진입 시 미리 확인해서 배너로 경고
    api<{ valid: boolean; blogId: string | null; reason?: string }>("/api/naver/session").then(setSession).catch(() => {});
  }, [load, loadChecks]);

  useEffect(() => {
    if (!confirmLive) return;
    const t = setTimeout(() => setConfirmLive(false), 5000);
    return () => clearTimeout(t);
  }, [confirmLive]);

  const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  async function save(): Promise<boolean> {
    setBusy("저장 중…");
    try {
      await api(`/api/draft/${draftId}`, { method: "PATCH", json: { title, bodyText, tags: splitList(tags), places: splitList(places) } });
      setDirty(false);
      await loadChecks();
      setMessage({ ok: true, text: "저장했습니다." });
      return true;
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish(mode: "draft" | "live") {
    if (mode === "live" && !confirmLive) { setConfirmLive(true); return; }
    setConfirmLive(false);
    if (dirty && !(await save())) return;
    setBusy(mode === "draft" ? "네이버에 임시저장 중… (PC 화면에서 자동 입력이 진행됩니다)" : "네이버에 발행 중…");
    try {
      const r = await api<{ success: boolean; url: string | null; error: string | null; warnings?: string[] }>("/api/publish", { method: "POST", json: { draftId, mode } });
      const done = mode === "draft" ? "임시저장 완료 — 네이버에서 확인 후 직접 발행하세요." : `발행 완료${r.url ? `: ${r.url}` : ""}`;
      setMessage({ ok: !r.warnings?.length, text: [done, ...(r.warnings ?? [])].join(" ") });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="text-muted">{message?.text ?? "불러오는 중…"}</p>;

  return (
    <div className="space-y-4">
      {session && !session.valid && (
        <div className="rounded-lg border border-warn bg-warn/10 px-3 py-2 text-sm text-warn">
          네이버 로그인 확인 필요: {session.reason} <Link href="/settings" className="underline">설정에서 로그인</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted">키워드 {data.draft.keyword}{data.draft.businessName ? ` · 상호 ${data.draft.businessName}` : ""} · 상태 {data.draft.status}</p>
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={save} disabled={Boolean(busy) || !dirty}>저장</button>
          <button type="button" className="btn-primary" onClick={() => publish("draft")} disabled={Boolean(busy)}>네이버 임시저장</button>
          <button type="button" className={confirmLive ? "btn border-danger text-danger" : "btn"} onClick={() => publish("live")} disabled={Boolean(busy)}>
            {confirmLive ? "정말 발행할까요? 한 번 더 누르세요" : "바로 발행"}
          </button>
        </div>
      </div>

      {busy && <p className="text-sm text-brand">{busy}</p>}
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-brand/10 text-brand" : "bg-danger/10 text-danger"}`}>{message.text}</p>}

      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-brand font-semibold text-fg" : "border-transparent text-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "edit" && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="t">제목</label>
            <input id="t" className="input" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          </div>
          <div>
            <label className="label" htmlFor="b">본문 — [[H]]소제목[[/H]], [[TABLE]]…[[/TABLE]], **굵게**, __밑줄__, ==하이라이트==, 한 줄에 한 문장</label>
            <textarea id="b" className="input min-h-[60vh] font-mono text-xs leading-6" value={bodyText} onChange={(e) => { setBodyText(e.target.value); setDirty(true); }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="tg">태그 (쉼표로 구분)</label>
              <input id="tg" className="input" value={tags} onChange={(e) => { setTags(e.target.value); setDirty(true); }} />
            </div>
            <div>
              <label className="label" htmlFor="pl">지도 첨부 장소 (쉼표로 구분)</label>
              <input id="pl" className="input" value={places} onChange={(e) => { setPlaces(e.target.value); setDirty(true); }} />
            </div>
          </div>
        </div>
      )}

      {tab === "preview" && <DraftPreview title={title} bodyText={bodyText} images={data.images} tags={splitList(tags)} />}

      {tab === "checks" && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted">저장된 최신 내용 기준 재검사{dirty ? " (저장 안 한 변경사항은 반영 안 됨)" : ""}</p>
            <button type="button" className="btn" onClick={loadChecks}>다시 검사</button>
          </div>
          {checks ? <CheckList checks={checks} /> : <p className="text-sm text-muted">검사 중…</p>}
        </div>
      )}

      {tab === "report" && <GenerationReport report={data.draft.report} />}
    </div>
  );
}
