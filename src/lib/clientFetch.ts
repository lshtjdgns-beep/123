// 클라이언트 fetch 헬퍼. 실패하면 서버의 한국어 에러 메시지로 throw.
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data;
}

export const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}

/** SQLite datetime('now')는 UTC 문자열("YYYY-MM-DD HH:MM:SS") */
export function parseDbTime(s: string | null | undefined): number {
  if (!s) return Date.now();
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}
