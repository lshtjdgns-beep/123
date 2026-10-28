// 워치독 + 폰용 "서버 켜기" 페이지(포트 3001).
//
// - 5초마다 http://127.0.0.1:3000/ 헬스체크. 죽어 있으면(포트 주인 없음) dev.cmd를 띄워 재시작,
//   응답은 없는데 포트 주인이 있으면(멈춘 상태) taskkill /PID .. /T /F 후 재시작.
// - 3001 포트에서 작은 HTML 페이지를 Next 없이 순수 http 모듈로 서빙 — 폰에서 서버가 완전히
//   죽어 있을 때도 열 수 있는 유일한 진입점. 사설 IP(LAN/Tailscale/localhost)만 허용, 그 외 403.
// - 같은 파일이 두 번 실행되면 포트 바인딩 실패(EADDRINUSE)로 두 번째가 스스로 종료.
// - 접속 로그는 data/supervisor.log. 3초 간격 상태 폴링(/api/status)은 로그에서 제외(도배 방지).
//
// 앱 출력 로그: data/next-dev.log
// 실행: node scripts/supervisor.mjs   (자동 시작은 scripts/start-supervisor-hidden.ps1 -Install)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3000;
const PANEL_PORT = 3001;
const CHECK_MS = 5000;
const STARTUP_GRACE_MS = 120_000; // 첫 컴파일은 오래 걸린다 — 이 시간 동안은 "멈춤"으로 판단하지 않음
const HUNG_STRIKES = 4; // 포트 주인이 있는데 연속 N번 응답 없음 → 멈춤으로 판단
const LOG_FILE = path.join(ROOT, "data", "supervisor.log");
const IS_WIN = process.platform === "win32";

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
  process.stdout.write(line);
}

const state = {
  healthy: false,
  lastOkAt: null,
  lastRestartAt: null,
  restarts: 0,
  strikes: 0,
  startingUntil: 0,
  restarting: false, // 재시작 중엔 정기 헬스체크가 끼어들어 두 번째 앱을 띄우지 않게
  child: null,
};

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: APP_PORT, path: "/", timeout: 8000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

/** 3000 포트를 LISTEN 중인 PID(없으면 null) */
function portOwner() {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile("netstat", ["-ano", "-p", "TCP"], { windowsHide: true }, (err, out) => {
        if (err) return resolve(null);
        const line = out.split(/\r?\n/).find((l) => new RegExp(`[:.]${APP_PORT}\\s+\\S+\\s+LISTENING`, "i").test(l));
        const pid = line?.trim().split(/\s+/).pop();
        resolve(pid && /^\d+$/.test(pid) && pid !== "0" ? Number(pid) : null);
      });
    } else {
      execFile("lsof", ["-ti", `tcp:${APP_PORT}`, "-sTCP:LISTEN"], (err, out) => {
        const pid = out?.trim().split(/\s+/)[0];
        resolve(!err && pid ? Number(pid) : null);
      });
    }
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (IS_WIN) execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    // 리눅스/맥: 자식들 먼저(pkill -P), 그다음 본인
    else execFile("pkill", ["-KILL", "-P", String(pid)], () => { try { process.kill(pid, "SIGKILL"); } catch { /* 이미 종료 */ } resolve(); });
  });
}

const APP_LOG = path.join(ROOT, "data", "next-dev.log");

// ⚠ 창이 뜨지 않게 하려면:
//  - detached:true 금지 — Windows에서 콘솔 없는(DETACHED) cmd가 npm/node를 띄우면 그 손자
//    프로세스들이 각자 "새 콘솔"을 만들어서 터미널 창이 뜬다(windowsHide가 손자까지는 안 먹음,
//    Windows Terminal이 기본 터미널이면 탭으로 열림 — 사용자 PC에서 실제로 발생).
//  - cmd.exe / npm.cmd를 거치지 않고 node로 next를 직접 실행 + windowsHide(CREATE_NO_WINDOW).
//  - 출력은 data/next-dev.log로.
function startApp(reason) {
  log(`앱 시작 (${reason})`);
  const out = fs.openSync(APP_LOG, "a");
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  state.child = spawn(process.execPath, [nextBin, "dev", "-H", "0.0.0.0", "-p", String(APP_PORT)], {
    cwd: ROOT,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  fs.closeSync(out);
  state.child.on("exit", (code) => log(`앱 프로세스 종료 (code ${code})`));
  state.lastRestartAt = new Date().toISOString();
  state.restarts++;
  state.strikes = 0;
  state.startingUntil = Date.now() + STARTUP_GRACE_MS;
}

async function restartApp(reason) {
  if (state.restarting) return;
  state.restarting = true;
  try {
    // 우리가 띄운 next dev(부모)와 포트 주인(next-server 자식)을 둘 다 트리째 정리
    const pids = new Set([state.child?.exitCode === null ? state.child.pid : null, await portOwner()].filter(Boolean));
    for (const pid of pids) {
      log(`PID ${pid} 강제 종료 (${reason})`);
      await killTree(pid);
    }
    if (pids.size) await new Promise((r) => setTimeout(r, 1500));
    startApp(reason);
  } finally {
    state.restarting = false;
  }
}

async function tick() {
  const ok = await healthCheck();
  state.healthy = ok;
  if (ok) {
    state.lastOkAt = new Date().toISOString();
    state.strikes = 0;
    state.startingUntil = 0;
    return;
  }
  if (state.restarting || Date.now() < state.startingUntil) return; // 재시작 중이거나 아직 켜지는 중
  const pid = await portOwner();
  if (!pid) {
    startApp("헬스체크 실패, 포트 주인 없음");
    return;
  }
  state.strikes++;
  if (state.strikes >= HUNG_STRIKES) await restartApp(`응답 없음 ${state.strikes}회`);
}

// ---------------------------------------------------------------- 패널(3001)

function isPrivate(ip) {
  const a = (ip ?? "").replace(/^::ffff:/, "");
  if (a === "::1" || a.startsWith("127.")) return true;
  if (/^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  const m = /^100\.(\d+)\./.exec(a); // Tailscale 100.64.0.0/10
  return Boolean(m && Number(m[1]) >= 64 && Number(m[1]) <= 127);
}

// ⚠ confirm() 금지 — 카카오톡/네이버 인앱 브라우저 등이 confirm()을 조용히 무시해서 버튼이
//   눌리는데 아무 일도 안 일어나는 것처럼 보인다. 버튼 텍스트를 바꿔 "두 번 탭"으로 확인.
const PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>블로그 서버 관리</title>
<style>
  body{font-family:system-ui,"Malgun Gothic",sans-serif;margin:0;padding:24px 16px;background:#f6f7f9;color:#1d2329}
  .card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #dfe3e8;border-radius:14px;padding:20px}
  h1{font-size:20px;margin:0 0 12px}
  .st{font-size:15px;margin:8px 0 16px}
  .ok{color:#03a94d;font-weight:700}.bad{color:#d23c3c;font-weight:700}.wait{color:#b7791f;font-weight:700}
  button{display:block;width:100%;padding:14px;margin:8px 0;font-size:16px;border-radius:10px;border:1px solid #dfe3e8;background:#fff}
  button.primary{background:#03a94d;color:#fff;border:none;font-weight:700}
  button.armed{background:#d23c3c;color:#fff;border:none}
  a{color:#03a94d}
  small{color:#5d6874}
</style></head><body><div class="card">
<h1>블로그 자동화 서버</h1>
<div class="st" id="st">상태 확인 중…</div>
<button class="primary" id="start">서버 켜기</button>
<button id="restart">다시 시작</button>
<p><a id="open" href="#">대시보드 열기 →</a></p>
<small id="info"></small>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  $("open").href = location.protocol + "//" + location.hostname + ":${APP_PORT}/";
  async function refresh() {
    try {
      const s = await (await fetch("/api/status", { cache: "no-store" })).json();
      const el = $("st");
      if (s.healthy) { el.innerHTML = '<span class="ok">● 실행 중</span>'; }
      else if (s.starting) { el.innerHTML = '<span class="wait">● 켜는 중… (첫 실행은 1~2분 걸려요)</span>'; }
      else { el.innerHTML = '<span class="bad">● 꺼져 있음</span>'; }
      $("info").textContent = "재시작 " + s.restarts + "회" + (s.lastRestartAt ? " · 마지막 " + new Date(s.lastRestartAt).toLocaleString("ko-KR") : "");
    } catch (e) { $("st").innerHTML = '<span class="bad">관리 서버 연결 실패</span>'; }
  }
  async function post(url) {
    try { await fetch(url, { method: "POST" }); } catch (e) {}
    refresh();
  }
  $("start").onclick = () => post("/api/start");
  let armed = null;
  $("restart").onclick = () => {
    const b = $("restart");
    if (!armed) {
      b.textContent = "정말요? 한 번 더 누르세요";
      b.classList.add("armed");
      armed = setTimeout(() => { armed = null; b.textContent = "다시 시작"; b.classList.remove("armed"); }, 5000);
      return;
    }
    clearTimeout(armed); armed = null;
    b.textContent = "다시 시작"; b.classList.remove("armed");
    post("/api/restart");
  };
  refresh();
  setInterval(refresh, 3000);
</script></body></html>`;

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress;
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/api/status") log(`${ip} ${req.method} ${url.pathname}`);
  if (!isPrivate(ip)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(PAGE);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, { healthy: state.healthy, starting: Date.now() < state.startingUntil, lastOkAt: state.lastOkAt, lastRestartAt: state.lastRestartAt, restarts: state.restarts });
  }
  if (req.method === "POST" && url.pathname === "/api/start") {
    if (state.healthy) return json(res, 200, { ok: true, message: "이미 실행 중" });
    if (Date.now() < state.startingUntil) return json(res, 200, { ok: true, message: "켜는 중" });
    const pid = await portOwner();
    if (pid) await restartApp("패널에서 켜기(멈춘 프로세스 정리)");
    else startApp("패널에서 켜기");
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/restart") {
    await restartApp("패널에서 다시 시작");
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: "not found" });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log(`포트 ${PANEL_PORT} 사용 중 — 이미 워치독이 실행 중이므로 종료합니다.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PANEL_PORT, "0.0.0.0", () => {
  log(`워치독 시작 (패널 http://0.0.0.0:${PANEL_PORT}/, 앱 포트 ${APP_PORT})`);
  void tick();
  setInterval(() => { void tick().catch((e) => log(`tick 오류: ${e.message}`)); }, CHECK_MS);
});
