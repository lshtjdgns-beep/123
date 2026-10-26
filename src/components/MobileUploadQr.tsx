"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/clientFetch";

type Endpoint = { ip: string; url: string; qr: string };
type Info = { lan: Endpoint[]; tailscale: Endpoint[] };

/** 폰으로 대시보드를 열어 사진 업로드·실행까지 — 집 안(LAN) / 집 밖(Tailscale) QR 둘 다 */
export default function MobileUploadQr() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Info>("/api/network-info").then(setInfo).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!info) return <p className="text-sm text-muted">네트워크 정보 확인 중…</p>;

  const groups: { label: string; hint: string; items: Endpoint[] }[] = [
    { label: "같은 와이파이(LAN)", hint: "집 안에서 폰으로 접속", items: info.lan },
    { label: "Tailscale", hint: "집 밖에서도 접속(폰에 Tailscale 앱 필요)", items: info.tailscale },
  ];

  return (
    <div className="flex flex-wrap gap-4">
      {groups.map((g) => (
        <div key={g.label} className="min-w-40">
          <p className="text-sm font-semibold">{g.label}</p>
          <p className="mb-2 text-xs text-muted">{g.hint}</p>
          {g.items.length === 0 && <p className="text-xs text-muted">주소 없음</p>}
          {g.items.map((e) => (
            <div key={e.ip} className="mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.qr} alt={`${g.label} 접속 QR`} className="h-36 w-36 rounded bg-white p-1" />
              <p className="mt-1 font-mono text-xs">{e.url}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
