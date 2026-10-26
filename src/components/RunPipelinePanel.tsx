"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, formatElapsed, parseDbTime } from "@/lib/clientFetch";

type RunStatus = {
  status: "pending" | "collecting" | "generating" | "sourcing_images" | "ready" | "failed";
  detail: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  draftId: string | null;
};

const STATUS_LABEL: Record<RunStatus["status"], string> = {
  pending: "준비 중",
  collecting: "자료 수집·분석 중",
  generating: "AI 초안 작성·검증 중",
  sourcing_images: "이미지 준비·임시저장 중",
  ready: "완료",
  failed: "실패",
};

const RUN_KEY = "naverBlog.currentRunId";

function readStoredRun(): string | null {
  try { return localStorage.getItem(RUN_KEY); } catch { return null; }
}
function storeRun(id: string | null) {
  try { if (id) localStorage.setItem(RUN_KEY, id); else localStorage.removeItem(RUN_KEY); } catch { /* 저장 불가 환경 무시 */ }
}

type Uploaded = { name: string; original: string };

export default function RunPipelinePanel() {
  const [keyword, setKeyword] = useState("");
  const [rankKeyword, setRankKeyword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [generateAiPhotos, setGenerateAiPhotos] = useState(true);
  const [generateCardImages, setGenerateCardImages] = useState(false);
  const [autoSaveDraft, setAutoSaveDraft] = useState(true);
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  // 새로고침해도 진행 중인 실행을 이어서 보여준다
  useEffect(() => {
    const stored = readStoredRun();
    if (stored) queueMicrotask(() => setRunId(stored));
  }, []);

  // 1.5초 간격 폴링. ⚠ fetch 예외를 절대 그냥 던지지 않는다 — 폰 화면잠금/와이파이 전환 같은
  // 일시적 끊김에서 unhandled rejection이 나면 페이지 전체가 죽는다. 그 틱만 건너뛴다.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await api<RunStatus>(`/api/run/${runId}/status`);
        if (stopped) return;
        setRun(s);
        if (s.status === "ready" || s.status === "failed") {
          stopped = true;
          storeRun(null);
        }
      } catch (e) {
        if ((e as Error).message.includes("찾을 수 없")) { stopped = true; storeRun(null); }
      }
    };
    void tick();
    const t = setInterval(() => { if (!stopped) void tick(); }, 1500);
    return () => { stopped = true; clearInterval(t); };
  }, [runId]);

  // 경과시간 타이머 — 5분 넘게 걸리는 단계에서 "멈췄다"고 오해하지 않게
  const running = Boolean(runId) && run?.status !== "ready" && run?.status !== "failed";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function uploadFiles(files: FileList) {
    setError(null);
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      setUploading(`사진 업로드 중 (${i + 1}/${list.length})…`);
      const fd = new FormData();
      fd.append("files", list[i]);
      try {
        const r = await api<{ files: Uploaded[] }>("/api/photos/upload", { method: "POST", body: fd });
        setPhotos((p) => [...p, ...r.files]);
      } catch (e) {
        setError(`${list[i].name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function suggest() {
    if (!keyword.trim()) return;
    try {
      const r = await api<{ suggestions: string[] }>(`/api/keywords/suggest?q=${encodeURIComponent(keyword.trim())}`);
      setSuggestions(r.suggestions);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function start() {
    setError(null);
    setRun(null);
    try {
      const r = await api<{ runId: string }>("/api/run", {
        method: "POST",
        json: {
          keyword, rankKeyword: rankKeyword || null, businessName: businessName || null,
          photoPaths: photos.map((p) => p.name), generateAiPhotos, generateCardImages, autoSaveDraft,
        },
      });
      storeRun(r.runId);
      setRunId(r.runId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const elapsed = run ? (run.finishedAt ? parseDbTime(run.finishedAt) : now) - parseDbTime(run.startedAt) : 0;

  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-bold">새 글 만들기</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="kw">관심 키워드 (대표키워드)</label>
          <div className="flex gap-2">
            <input id="kw" className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 합정 맛집" />
            <button type="button" className="btn shrink-0" onClick={suggest} disabled={!keyword.trim()}>연관 키워드</button>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button key={s} type="button" className="rounded-full bg-subtle px-2.5 py-1 text-xs hover:bg-line" onClick={() => { setKeyword(s); setSuggestions([]); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="rk">상위노출 분석 키워드 (비우면 위 키워드)</label>
          <input id="rk" className="input" value={rankKeyword} onChange={(e) => setRankKeyword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="bn">홍보 상호명 (선택)</label>
          <input id="bn" className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="예: 어반플랜트 합정점" />
        </div>
      </div>

      <div>
        <label className="label">사진 첨부 (선택 — 메뉴판·가게 사진이 있으면 정확한 정보로 쓰입니다)</label>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="text-sm" onChange={(e) => e.target.files && uploadFiles(e.target.files)} disabled={Boolean(uploading)} />
          {photos.length > 0 && <span className="text-sm text-muted">{photos.length}장 첨부됨</span>}
          {photos.length > 0 && <button type="button" className="btn" onClick={() => setPhotos([])}>모두 빼기</button>}
        </div>
        {uploading && <p className="mt-1 text-sm text-brand">{uploading}</p>}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={generateAiPhotos} onChange={(e) => setGenerateAiPhotos(e.target.checked)} /> 사진이 없는 곳은 AI 이미지 생성</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={generateCardImages} onChange={(e) => setGenerateCardImages(e.target.checked)} /> 소제목 카드 이미지</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={autoSaveDraft} onChange={(e) => setAutoSaveDraft(e.target.checked)} /> 완료 후 네이버 임시저장</label>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={start} disabled={!keyword.trim() || Boolean(uploading) || running}>
          {running ? "진행 중…" : "글 만들기 시작"}
        </button>
        <span className="text-xs text-muted">발행은 자동으로 하지 않습니다 — 임시저장 후 네이버에서 직접 확인하고 발행하세요.</span>
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {runId && run && (
        <div className="rounded-lg border border-line bg-subtle p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`font-semibold ${run.status === "failed" ? "text-danger" : run.status === "ready" ? "text-brand" : ""}`}>
              {STATUS_LABEL[run.status]}
            </span>
            <span className="tabular-nums text-muted">경과 {formatElapsed(elapsed)}</span>
          </div>
          {run.detail && <p className="mt-1">{run.detail}</p>}
          {run.error && <p className="mt-1 text-danger">{run.error}</p>}
          {running && <div className="mt-2 h-1 overflow-hidden rounded bg-line"><div className="h-full w-1/3 animate-pulse rounded bg-brand" /></div>}
          {run.draftId && run.status === "ready" && (
            <Link href={`/draft/${run.draftId}`} className="btn-primary mt-3">초안 확인하기</Link>
          )}
        </div>
      )}
    </section>
  );
}
