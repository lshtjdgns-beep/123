import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 모바일(LAN/Tailscale)에서 dev 서버 접속 시 Next의 cross-origin 차단(403)을
  // 우회하기 위해 필요. 이거 없으면 폰에서 열었을 때 페이지가 안 뜨거나
  // 버튼이 눌리지 않는 것처럼 보인다(React가 마운트를 못 끝냄).
  // Tailscale IP는 100.64.0.0/10 대역이라 와일드카드로 넓게 열어 둔다.
  // 본인 Tailscale IP를 알면 "100.x.y.z" 하나로 좁혀도 된다.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "100.*.*.*"],
  // 네이티브/서브프로세스 패키지는 번들하지 않는다.
  serverExternalPackages: ["sharp", "playwright", "@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
