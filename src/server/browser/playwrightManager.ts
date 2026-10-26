import "server-only";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from "playwright";
import { SESSIONS_DIR, sessionStatePath } from "@/lib/paths";

// 시스템 Edge를 쓴다(`npx playwright install` 불필요).
// Edge가 없는 환경(예: 리눅스 CI)에서는 Playwright 기본 Chromium으로 폴백.
const globalForBrowser = globalThis as unknown as {
  __publicBrowser?: Promise<Browser>;
  __headedBrowser?: Promise<Browser>;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

async function launch(opts: LaunchOptions): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "msedge", ...opts });
  } catch (err) {
    console.warn("[playwright] msedge 실행 실패, 기본 Chromium으로 폴백:", (err as Error).message);
    return chromium.launch(opts);
  }
}

function cachedBrowser(key: "__publicBrowser" | "__headedBrowser", opts: LaunchOptions): Promise<Browser> {
  const existing = globalForBrowser[key];
  if (existing) return existing;
  const p = launch(opts).then((b) => {
    b.on("disconnected", () => {
      if (globalForBrowser[key] === p) globalForBrowser[key] = undefined;
    });
    return b;
  });
  p.catch(() => { globalForBrowser[key] = undefined; });
  globalForBrowser[key] = p;
  return p;
}

/** 공개 페이지 스크래핑용(로그인 불필요) — headless */
export async function getPublicContext(): Promise<BrowserContext> {
  const browser = await cachedBrowser("__publicBrowser", { headless: true });
  return browser.newContext({ userAgent: USER_AGENT, locale: "ko-KR", viewport: { width: 1280, height: 900 } });
}

/** 사용자가 볼 수 있는 창(로그인/발행용) */
export async function getHeadedBrowser(): Promise<Browser> {
  return cachedBrowser("__headedBrowser", { headless: false, args: ["--start-maximized"] });
}

/** 계정별 storageState로 headed 컨텍스트를 띄운다. 세션 파일이 없으면 빈 컨텍스트. */
export async function launchHeadedNaverContext(blogId: string | null): Promise<BrowserContext> {
  const browser = await getHeadedBrowser();
  const statePath = blogId ? sessionStatePath(blogId) : null;
  return browser.newContext({
    userAgent: USER_AGENT,
    locale: "ko-KR",
    viewport: null,
    ...(statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}),
  });
}

/** 세션 파일만 쓰는 headless 컨텍스트(세션 유효성 확인용) */
export async function launchHeadlessNaverContext(blogId: string): Promise<BrowserContext | null> {
  const statePath = sessionStatePath(blogId);
  if (!fs.existsSync(statePath)) return null;
  const browser = await cachedBrowser("__publicBrowser", { headless: true });
  return browser.newContext({ userAgent: USER_AGENT, locale: "ko-KR", storageState: statePath });
}

export async function saveStorageState(context: BrowserContext, filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await context.storageState({ path: filePath });
}

export function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}
