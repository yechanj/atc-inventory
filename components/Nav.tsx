"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/cassettes", label: "전체 재고" },
  { href: "/refill", label: "보충 입력" },
  { href: "/upload", label: "사용량 업로드" },
  { href: "/history", label: "변동 기록" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setHospitalName(d.data?.hospitalName ?? ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 sm:px-6">
        <Link href="/cassettes" className="mr-4 py-4 font-omyu text-2xl text-brand-700">
          PharmAssi
        </Link>

        {/* 데스크탑 네비 */}
        <nav className="hidden md:flex items-center gap-1">
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

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {hospitalName && (
            <span className="hidden sm:flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600">
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
              {hospitalName}
            </span>
          )}
          <div className="hidden md:block h-4 w-px bg-slate-200" />
          <button
            onClick={logout}
            className="hidden md:block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            로그아웃
          </button>

          {/* 모바일 햄버거 버튼 */}
          <button
            className="md:hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="메뉴"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 모바일 드롭다운 메뉴 */}
      {menuOpen && (
        <div className="md:hidden border-t border-slate-100 bg-white px-4 pb-3 pt-2">
          <nav className="flex flex-col gap-0.5">
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
          {hospitalName && (
            <div className="mt-2 flex items-center gap-1.5 px-4 py-1.5 text-sm text-slate-500">
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
              {hospitalName}
            </div>
          )}
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button
              onClick={logout}
              className="w-full rounded-lg px-4 py-2.5 text-left text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              로그아웃
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
