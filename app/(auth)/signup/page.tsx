"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, hospitalName }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "회원가입에 실패했습니다.");
        return;
      }
      router.push("/cassettes");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="mb-8 text-center">
          <span className="font-omyu text-4xl text-brand-700">PharmAssi</span>
          <p className="mt-2 text-sm text-slate-500">카세트 재고·보충 관리 시스템</p>
        </div>

        <div className="card p-8">
          <h1 className="mb-6 text-lg font-bold text-slate-800">회원가입</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label block mb-1.5">병원·약국명</label>
              <input
                className="input w-full"
                value={hospitalName}
                onChange={(e) => setHospitalName(e.target.value)}
                placeholder="예: OO병원"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="label block mb-1.5">아이디</label>
              <input
                className="input w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디 입력"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label block mb-1.5">비밀번호</label>
              <input
                type="password"
                className="input w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="4자 이상"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? "가입 중…" : "가입하기"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
