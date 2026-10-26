import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "네이버 블로그 자동화",
  description: "상위노출 분석 · 말투 반영 · 자동 검증 · 네이버 임시저장까지",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/", label: "대시보드" },
  { href: "/history", label: "발행 이력" },
  { href: "/settings", label: "설정" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3">
            <Link href="/" className="mr-4 font-bold text-brand">블로그 자동화</Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
