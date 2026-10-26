"use client";

import { useCallback, useEffect, useState } from "react";
import NaverLoginButton from "@/components/NaverLoginButton";
import MobileUploadQr from "@/components/MobileUploadQr";
import { api } from "@/lib/clientFetch";

type Config = {
  blogId: string | null;
  accounts: { blogId: string; lastValidatedAt: string | null; valid: boolean; createdAt: string }[];
  apiKeys: { gemini: boolean; openai: boolean; unsplash: boolean; pixabay: boolean; anthropicApiKeyPresent: boolean };
};
type Profile = { builtAt: string; postsUsed: number; titles: string[]; toneSummary: string | null; promptFragment: string } | null;
type ClaudeCheck = { ok: boolean; message: string; apiKeyIgnored: boolean; live?: boolean; reply?: string; ms?: number };

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [claude, setClaude] = useState<ClaudeCheck | null>(null);
  const [session, setSession] = useState<{ valid: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [c, p, cl] = await Promise.all([
      api<Config>("/api/config"),
      api<{ profile: Profile }>("/api/style-profile"),
      api<ClaudeCheck>("/api/claude/check"),
    ]);
    setConfig(c);
    setProfile(p.profile);
    setClaude(cl);
  }, []);

  useEffect(() => {
    queueMicrotask(() => load().catch((e) => setMsg({ ok: false, text: (e as Error).message })));
  }, [load]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  const switchAccount = (blogId: string) => act("switch", async () => {
    await api("/api/config", { method: "PUT", json: { blogId } });
    setSession(null);
    await load();
    setMsg({ ok: true, text: `활성 계정을 ${blogId}(으)로 바꿨습니다.` });
  });
  const checkSession = () => act("session", async () => setSession(await api("/api/naver/session")));
  const rebuildStyle = () => act("style", async () => {
    setProfile((await api<{ profile: Profile }>("/api/style-profile", { method: "POST" })).profile);
    setMsg({ ok: true, text: "말투를 다시 분석했습니다." });
  });
  const liveClaude = () => act("claude", async () => setClaude(await api("/api/claude/check", { method: "POST" })));

  const onLoggedIn = useCallback(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">설정</h1>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-brand/10 text-brand" : "bg-danger/10 text-danger"}`}>{msg.text}</p>}

      <section className="card space-y-3">
        <h2 className="font-bold">네이버 계정</h2>
        <p className="text-sm">활성 블로그: <b>{config?.blogId ?? "없음"}</b></p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={checkSession} disabled={Boolean(busy)}>{busy === "session" ? "확인 중…" : "로그인 상태 확인"}</button>
          {session && <span className={`text-sm ${session.valid ? "text-brand" : "text-danger"}`}>{session.valid ? "로그인 유효" : session.reason}</span>}
        </div>
        {config && config.accounts.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {config.accounts.map((a) => (
              <li key={a.blogId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><b>{a.blogId}</b> <span className="text-xs text-muted">마지막 확인 {a.lastValidatedAt ?? "-"}</span></span>
                {a.blogId === config.blogId ? <span className="text-xs text-brand">사용 중</span> : (
                  <button type="button" className="btn" onClick={() => switchAccount(a.blogId)} disabled={Boolean(busy)}>이 계정 사용</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm font-semibold">새 계정 로그인 / 다시 로그인</p>
          <NaverLoginButton onLoggedIn={onLoggedIn} />
        </div>
      </section>

      <section className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">내 블로그 말투 분석</h2>
          <button type="button" className="btn" onClick={rebuildStyle} disabled={Boolean(busy) || !config?.blogId}>{busy === "style" ? "분석 중…" : "지금 다시 분석"}</button>
        </div>
        {profile ? (
          <div className="space-y-1 text-sm">
            <p className="text-muted">{new Date(profile.builtAt).toLocaleString("ko-KR")} · 최근 글 {profile.postsUsed}개 ({profile.titles.join(" / ")})</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-subtle p-3 font-sans text-xs">{profile.promptFragment}</pre>
          </div>
        ) : <p className="text-sm text-muted">저장된 분석이 없습니다(글 생성 시 자동으로 분석합니다).</p>}
      </section>

      <section className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Claude 인증 상태</h2>
          <button type="button" className="btn" onClick={liveClaude} disabled={Boolean(busy)}>{busy === "claude" ? "호출 중…" : "실제 호출 테스트"}</button>
        </div>
        {claude && (
          <div className="text-sm">
            <p className={claude.ok ? "text-brand" : "text-danger"}>{claude.message}</p>
            {claude.apiKeyIgnored && <p className="text-warn">.env.local에 ANTHROPIC_API_KEY가 있지만 구독 로그인을 우선하도록 Claude 호출에서는 무시합니다. 가능하면 그 줄을 비워두세요.</p>}
            {claude.live && <p className="text-muted">응답 &quot;{claude.reply}&quot; ({claude.ms}ms)</p>}
          </div>
        )}
      </section>

      <section className="card space-y-1 text-sm">
        <h2 className="font-bold">이미지 API 키 (.env.local)</h2>
        {config && Object.entries({ "Unsplash": config.apiKeys.unsplash, "Pixabay": config.apiKeys.pixabay, "Gemini(이미지 생성)": config.apiKeys.gemini, "OpenAI(이미지 생성)": config.apiKeys.openai })
          .map(([k, v]) => <p key={k}>{v ? "✔" : "—"} {k}</p>)}
      </section>

      <section className="card">
        <h2 className="mb-2 font-bold">폰에서 접속</h2>
        <MobileUploadQr />
      </section>
    </div>
  );
}
