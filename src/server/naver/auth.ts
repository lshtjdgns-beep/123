import "server-only";
import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";
import { sessionStatePath } from "@/lib/paths";
import { getPublicContext, launchHeadedNaverContext, launchHeadlessNaverContext, saveStorageState, ensureSessionsDir } from "../browser/playwrightManager";
import { naverLogin } from "./naverSelectors";
import { recordNaverSession, markSessionValidated } from "../db/repositories/naverSessions";
import { setActiveBlogId, getActiveBlogId } from "../db/repositories/settings";

export type LoginState = "idle" | "waiting" | "success" | "failed" | "cancelled";

export type LoginStatus = {
  method: "manual" | "qr" | null;
  state: LoginState;
  blogId: string | null;
  error: string | null;
  /** QR 전용 */
  qrDataUrl: string | null;
  qrNumber: string | null;
  qrRefreshedAt: number | null;
  startedAt: number | null;
};

type LoginFlow = { status: LoginStatus; context: BrowserContext | null; cancel: () => Promise<void> };

const g = globalThis as unknown as { __naverLogin?: LoginFlow };

const POLL_MS = 1500;
const MANUAL_TIMEOUT_MS = 5 * 60_000;
const QR_TIMEOUT_MS = 10 * 60_000;
const QR_REFRESH_MS = 150_000; // 네이버 QR은 약 3분마다 만료 → 2.5분마다 새로고침

const idleStatus = (): LoginStatus => ({ method: null, state: "idle", blogId: null, error: null, qrDataUrl: null, qrNumber: null, qrRefreshedAt: null, startedAt: null });

export function getLoginStatus(): LoginStatus {
  return g.__naverLogin?.status ?? idleStatus();
}

async function hasLoginCookies(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.naver.com");
  return cookies.some((c) => c.name === naverLogin.sessionCookie);
}

/** https://blog.naver.com/MyBlog.naver 리다이렉트 결과에서 blogId를 얻는다 */
export async function resolveBlogId(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(naverLogin.myBlogUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const candidates = [page.url(), ...page.frames().map((f) => f.url())];
    for (const u of candidates) {
      const m = /blog\.naver\.com\/(?!MyBlog|PostList|PostView|prologue)([\w-]+)(?:[/?#]|$)/.exec(u) ?? /[?&]blogId=([\w-]+)/.exec(u);
      if (m) return m[1];
    }
    throw new Error(`블로그 ID를 확인하지 못했습니다(${page.url()}). 블로그를 개설한 계정인지 확인해주세요.`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function finishLogin(flow: LoginFlow, context: BrowserContext) {
  const blogId = await resolveBlogId(context);
  ensureSessionsDir();
  const file = sessionStatePath(blogId);
  await saveStorageState(context, file);
  recordNaverSession(blogId, file);
  setActiveBlogId(blogId);
  flow.status = { ...flow.status, state: "success", blogId };
}

async function cleanup(flow: LoginFlow) {
  const ctx = flow.context;
  flow.context = null;
  if (ctx) await ctx.close().catch(() => {});
}

function beginFlow(method: "manual" | "qr"): LoginFlow {
  const prev = g.__naverLogin;
  if (prev && prev.status.state === "waiting") void prev.cancel();
  const flow: LoginFlow = {
    status: { ...idleStatus(), method, state: "waiting", startedAt: Date.now() },
    context: null,
    cancel: async () => {
      if (flow.status.state === "waiting") flow.status = { ...flow.status, state: "cancelled" };
      await cleanup(flow);
    },
  };
  g.__naverLogin = flow;
  return flow;
}

/**
 * PC 화면 로그인: headed 창에서 사용자가 직접 아이디/비번(캡차 포함) 입력.
 * ⚠ 폰에서는 쓸 수 없다(창이 PC 모니터에 뜬다) — UI에서 폰이면 비활성화.
 */
export async function startManualLogin(): Promise<LoginStatus> {
  const flow = beginFlow("manual");
  const context = await launchHeadedNaverContext(null);
  flow.context = context;
  const page = await context.newPage();
  await page.goto(naverLogin.loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  void (async () => {
    const deadline = Date.now() + MANUAL_TIMEOUT_MS;
    try {
      while (flow.status.state === "waiting") {
        if (Date.now() > deadline) throw new Error("로그인 대기 시간(5분)이 지났습니다.");
        if (page.isClosed()) throw new Error("로그인 창이 닫혔습니다.");
        if (await hasLoginCookies(context)) {
          await finishLogin(flow, context);
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      if (flow.status.state === "waiting") flow.status = { ...flow.status, state: "failed", error: (e as Error).message };
    } finally {
      await cleanup(flow);
    }
  })();
  return flow.status;
}

async function readQr(page: Page, flow: LoginFlow) {
  await page.goto(naverLogin.qrLoginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const img = page.locator(naverLogin.qrImage).first();
  await img.waitFor({ state: "visible", timeout: 15000 });
  const src = await img.getAttribute("src");
  let dataUrl: string;
  if (src?.startsWith("data:")) dataUrl = src;
  else dataUrl = `data:image/png;base64,${(await img.screenshot()).toString("base64")}`;
  const number = (await page.locator(naverLogin.qrNumber).first().textContent({ timeout: 3000 }).catch(() => null))?.trim() ?? null;
  flow.status = { ...flow.status, qrDataUrl: dataUrl, qrNumber: number, qrRefreshedAt: Date.now() };
}

/**
 * QR 로그인: 네이버 QR 페이지의 QR 이미지와 확인숫자를 대시보드에 그대로 보여준다.
 * 사용자는 QR을 스크린샷 → 네이버 앱 QR스캔(검색창 옆 렌즈) → 갤러리에서 선택으로 승인.
 * 폰에서도 동작하는 유일한 로그인 방법.
 */
export async function startQrLogin(): Promise<LoginStatus> {
  const flow = beginFlow("qr");
  const context = await getPublicContext();
  flow.context = context;
  const page = await context.newPage();
  try {
    await readQr(page, flow);
  } catch (e) {
    flow.status = { ...flow.status, state: "failed", error: `QR을 불러오지 못했습니다: ${(e as Error).message}` };
    await cleanup(flow);
    return flow.status;
  }
  void (async () => {
    const deadline = Date.now() + QR_TIMEOUT_MS;
    try {
      while (flow.status.state === "waiting") {
        if (Date.now() > deadline) throw new Error("QR 로그인 대기 시간(10분)이 지났습니다. 다시 시도해주세요.");
        if (await hasLoginCookies(context)) {
          await finishLogin(flow, context);
          break;
        }
        if (Date.now() - (flow.status.qrRefreshedAt ?? 0) > QR_REFRESH_MS) await readQr(page, flow).catch(() => {});
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      if (flow.status.state === "waiting") flow.status = { ...flow.status, state: "failed", error: (e as Error).message };
    } finally {
      await cleanup(flow);
    }
  })();
  return flow.status;
}

/** 꼬였을 때 폰에서도 PC의 로그인창/QR 세션을 강제로 정리할 수 있게 */
export async function cancelLogin(): Promise<LoginStatus> {
  const flow = g.__naverLogin;
  if (flow) await flow.cancel();
  return getLoginStatus();
}

/**
 * 활성 계정으로 naver.com에 접속해 NID_SES + NID_AUT 쿠키 존재로 판단한다.
 * (로그아웃 상태에서도 nidlogin 링크는 항상 있으므로 그걸로 판단하면 안 된다)
 * 유효하면 storageState를 다시 저장 — 네이버가 활동마다 세션 쿠키를 회전시키므로,
 * 안 그러면 몇 번 체크만에 오래된 쿠키로 취급되어 로그아웃 오판.
 */
export async function isSessionValid(blogId: string | null = getActiveBlogId()): Promise<{ valid: boolean; blogId: string | null; reason?: string }> {
  if (!blogId) return { valid: false, blogId, reason: "활성 블로그 계정이 없습니다. 먼저 네이버에 로그인해주세요." };
  if (!fs.existsSync(sessionStatePath(blogId))) return { valid: false, blogId, reason: "이 계정의 저장된 로그인 세션이 없습니다." };
  const context = await launchHeadlessNaverContext(blogId);
  if (!context) return { valid: false, blogId, reason: "세션 파일을 읽지 못했습니다." };
  try {
    const page = await context.newPage();
    await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    const cookies = await context.cookies("https://www.naver.com");
    const valid = cookies.some((c) => c.name === naverLogin.sessionCookie) && cookies.some((c) => c.name === naverLogin.authCookie);
    if (valid) await saveStorageState(context, sessionStatePath(blogId));
    markSessionValidated(blogId, valid);
    return valid ? { valid, blogId } : { valid, blogId, reason: "네이버 로그인이 만료되었습니다. 다시 로그인해주세요." };
  } finally {
    await context.close().catch(() => {});
  }
}
