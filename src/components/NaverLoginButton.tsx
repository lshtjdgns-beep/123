"use client";

import { useEffect, useState } from "react";
import { api, isPhone } from "@/lib/clientFetch";

type LoginStatus = {
  method: "manual" | "qr" | null;
  state: "idle" | "waiting" | "success" | "failed" | "cancelled";
  blogId: string | null;
  error: string | null;
  qrDataUrl: string | null;
  qrNumber: string | null;
};

/**
 * 폰에서는 QR 로그인만 된다 — PC 화면 로그인은 창이 PC 모니터에 떠서 폰에서 누르면
 * 완료할 사람이 없다(실제로 "로그인 창 대기중"에 멈춰서 발견). 폰이면 QR을 대표 버튼으로,
 * PC 로그인은 비활성화 + 안내. 둘 다 취소(DELETE)로 꼬인 상태를 강제 정리할 수 있다.
 */
export default function NaverLoginButton({ onLoggedIn }: { onLoggedIn?: (blogId: string) => void }) {
  const [phone, setPhone] = useState(false);
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setPhone(isPhone()));
    api<LoginStatus>("/api/naver/login-status").then(setStatus).catch(() => {});
  }, []);

  const waiting = status?.state === "waiting";

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const s = await api<LoginStatus>("/api/naver/login-status");
        setStatus(s);
        if (s.state === "success" && s.blogId) onLoggedIn?.(s.blogId);
      } catch { /* 일시적 끊김은 다음 틱에서 재시도 */ }
    }, 1500);
    return () => clearInterval(t);
  }, [waiting, onLoggedIn]);

  async function run(fn: () => Promise<LoginStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const startQr = () => run(() => api("/api/naver/login-qr", { method: "POST" }));
  const startManual = () => run(() => api("/api/naver/login", { method: "POST" }));
  const cancel = () => run(() => api("/api/naver/login", { method: "DELETE" }));

  const qrButton = (
    <button type="button" className={phone ? "btn-primary" : "btn"} onClick={startQr} disabled={busy || waiting}>QR로 로그인</button>
  );
  const pcButton = (
    <button type="button" className={phone ? "btn" : "btn-primary"} onClick={startManual} disabled={busy || waiting || phone}>PC 화면에서 로그인</button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {phone ? <>{qrButton}{pcButton}</> : <>{pcButton}{qrButton}</>}
        {(waiting || busy) && <button type="button" className="btn" onClick={cancel}>취소</button>}
      </div>
      {phone && <p className="text-xs text-muted">폰에서는 QR 로그인만 됩니다. PC 화면 로그인은 로그인 창이 PC 모니터에 뜹니다.</p>}

      {waiting && status?.method === "manual" && (
        <p className="text-sm text-brand">PC 화면에 뜬 네이버 로그인 창에서 아이디/비밀번호를 입력하세요. 로그인되면 자동으로 감지합니다.</p>
      )}
      {waiting && status?.method === "qr" && status.qrDataUrl && (
        <div className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={status.qrDataUrl} alt="네이버 로그인 QR" className="h-44 w-44 rounded bg-white p-1" />
            <div className="space-y-1 text-sm">
              {status.qrNumber && <p>확인 숫자: <b className="text-lg">{status.qrNumber}</b></p>}
              <ol className="list-decimal space-y-0.5 pl-4 text-muted">
                <li>이 QR을 <b>스크린샷</b>으로 저장</li>
                <li>네이버 앱 검색창 옆 <b>렌즈(QR스캔)</b> 아이콘</li>
                <li><b>갤러리</b>에서 스크린샷 선택 → 로그인 승인</li>
              </ol>
              <p className="text-xs text-muted">QR은 약 2.5분마다 자동으로 새로 고쳐집니다.</p>
            </div>
          </div>
        </div>
      )}
      {status?.state === "success" && status.blogId && <p className="text-sm text-brand">로그인 완료: <b>{status.blogId}</b> 계정이 활성화되었습니다.</p>}
      {status?.state === "failed" && <p className="text-sm text-danger">{status.error}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
