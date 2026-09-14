"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/cassettes", label: "전체 재고" },
  { href: "/today", label: "오늘 보충" },
  { href: "/refill", label: "보충 입력" },
  { href: "/upload", label: "사용량 업로드" },
  { href: "/history", label: "변동 기록" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-6">
        <Link href="/cassettes" className="mr-6 py-4 font-omyu text-2xl text-brand-700">
          ATC 재고
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "rounded-lg px-4 py-2.5 text-[15px] font-medium transition " +
                  (active
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100")
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <button
            onClick={logout}
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
