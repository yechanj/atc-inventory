"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, fmt } from "@/lib/client";
import { getRecommendation } from "@/lib/status";
import { StatusBadge } from "@/components/StatusBadge";
import { RefillModal } from "@/components/RefillModal";
import { AdjustModal } from "@/components/AdjustModal";
import { SettingsModal } from "@/components/SettingsModal";
import type { Cassette, Machine } from "@/lib/types";

const FILTERS = [
  { key: "ALL", label: "전체" },
  { key: "NORMAL", label: "정상" },
  { key: "REFILL", label: "보충 필요" },
  { key: "UNTRACKED", label: "미추적" },
  { key: "REVIEW", label: "확인 필요" },
];
const SORTS = [
  { key: "cassette", label: "카세트번호" },
  { key: "inventory", label: "현재고" },
  { key: "shortage", label: "재고 부족순" },
];

function CassettesInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(sp.get("status") ?? "ALL");
  const [sort, setSort] = useState("cassette");
  const [machineId, setMachineId] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [rows, setRows] = useState<Cassette[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [refillTarget, setRefillTarget] = useState<Cassette | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Cassette | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Cassette | null>(null);

  useEffect(() => {
    apiFetch<Machine[]>("/api/machines").then(setMachines).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ q, status, sort });
    if (machineId) params.set("machineId", machineId);
    try {
      const data = await apiFetch<Cassette[]>(`/api/cassettes?${params}`);
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [q, status, sort, machineId]);

  useEffect(() => {
    const t = setTimeout(load, 200); // 검색어 디바운스
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">
          전체 재고{" "}
          {rows && <span className="text-base font-normal text-slate-400">({rows.length})</span>}
        </h1>
        <div className="flex items-center gap-2">
          <Link href="/analysis" className="btn-secondary">
            사용량 분석
          </Link>
          <Link href="/stocktake" className="btn-secondary">
            재고조사
          </Link>
        </div>
      </div>

      {/* 컨트롤 바 */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        {/* 좌측: 상태 필터 탭 */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={
                "rounded-lg px-4 py-2 text-sm font-medium transition " +
                (status === f.key
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* 우측: 장비 · 정렬 · 검색 */}
        <div className="flex items-center gap-2">
          {machines.length > 1 && (
            <select className="input" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">전체 장비</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m._count?.cassettes ?? 0})
                </option>
              ))}
            </select>
          )}
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {/* 검색: label로 아이콘+input 묶음 */}
          <div className="flex w-64 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 cursor-text">
            <svg className="shrink-0 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="카세트번호 · 약품명 · 약품코드"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="card overflow-hidden">
        {error ? (
          <div className="p-10 text-center text-rose-600">불러오기 실패: {error}</div>
        ) : rows === null ? (
          <div className="p-10 text-center text-slate-400">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-400">조건에 맞는 카세트가 없습니다.</div>
        ) : (
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>카세트</th>
                  <th>약품명</th>
                  <th>약품코드</th>
                  <th className="num">현재고</th>
                  <th className="num">포장</th>
                  <th className="num">보충기준</th>
                  <th className="num">권장</th>
                  <th className="center">상태</th>
                  <th className="center">작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const rec = getRecommendation(c);
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">
                        {machines.length > 1 && (
                          <span className="mr-1 text-xs text-slate-400">{c.machine.name}</span>
                        )}
                        #{c.cassetteNumber}
                      </td>
                      <td className="font-medium">{c.drugName}</td>
                      <td className="text-slate-500 text-sm">{c.drugCode ?? "—"}</td>
                      <td className={"num font-semibold " + (rec.needsRefill ? "text-amber-700" : "")}>
                        {fmt(c.currentInventory)}
                      </td>
                      <td className="num text-slate-500">{fmt(c.packageSize)}</td>
                      <td className="num text-slate-500">{fmt(c.refillThreshold)}</td>
                      <td className="num">{rec.text}</td>
                      <td className="text-center">
                        <StatusBadge cassette={c} />
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition"
                            onClick={() => setRefillTarget(c)}
                          >
                            보충
                          </button>
                          <button
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200 transition"
                            onClick={() => setAdjustTarget(c)}
                          >
                            보정
                          </button>
                          <button
                            title="설정"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                            onClick={() => setSettingsTarget(c)}
                          >
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.383.929-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RefillModal cassette={refillTarget} onClose={() => setRefillTarget(null)} onDone={load} />
      <AdjustModal cassette={adjustTarget} onClose={() => setAdjustTarget(null)} onDone={load} />
      <SettingsModal cassette={settingsTarget} onClose={() => setSettingsTarget(null)} onDone={load} />
    </div>
  );
}

export default function CassettesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">불러오는 중…</div>}>
      <CassettesInner />
    </Suspense>
  );
}
