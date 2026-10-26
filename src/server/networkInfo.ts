import "server-only";
import os from "node:os";
import { execFile } from "node:child_process";
import QRCode from "qrcode";

type Endpoint = { ip: string; url: string; qr: string };

function isPrivateLan(ip: string) {
  return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** 100.64.0.0/10 (Tailscale CGNAT 대역) */
function isTailscale(ip: string) {
  const m = /^100\.(\d+)\./.exec(ip);
  return Boolean(m && Number(m[1]) >= 64 && Number(m[1]) <= 127);
}

function tailscaleCli(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("tailscale", ["ip", "-4"], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      resolve(err ? [] : stdout.split(/\s+/).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x)));
    });
  });
}

async function endpoint(ip: string, port: number): Promise<Endpoint> {
  const url = `http://${ip}:${port}`;
  return { ip, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function getNetworkInfo(port: number) {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => Boolean(a) && a!.family === "IPv4" && !a!.internal)
    .map((a) => a.address);
  const lan = [...new Set(addrs.filter(isPrivateLan))];
  const ts = [...new Set([...(await tailscaleCli()), ...addrs.filter(isTailscale)])];
  return {
    lan: await Promise.all(lan.map((ip) => endpoint(ip, port))),
    tailscale: await Promise.all(ts.map((ip) => endpoint(ip, port))),
  };
}
