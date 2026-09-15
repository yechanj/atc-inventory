"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, fmt } from "@/lib/client";
import { getCassetteStatus, getRecommendation } from "@/lib/status";
import { StatusBadge } from "@/components/StatusBadge";
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
const SPECIAL_SORTS = [
  { key: "inventory", label: "현재고순" },
  { key: "shortage", label: "재고 부족순" },
];
const COL_SORT_KEYS = new Set([
  "cassette", "cassette_asc", "cassette_desc",
  "drugCode_asc", "drugCode_desc",
  "drugName_asc", "drugName_desc",
]);

export function CassettesClient({
  initialRows,
  initialMachines,
  initialStatus,
}: {
  initialRows: Cassette[];
  initialMachines: Machine[];
  initialStatus: string;
}) {
  const [rows, setRows] = useState<Cassette[]>(initialRows);
  const [machines] = useState<Machine[]>(initialMachines);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [sort, setSort] = useState("cassette");
  const [machineId, setMachineId] = useState("");
  const [adjustTarget, setAdjustTarget] = useState<Cassette | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Cassette | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<Cassette[]>("/api/cassettes");
      setRows(data);
    } catch {}
  }, []);

  const filtered = useMemo(() => {
    let result = rows;

    if (machineId) {
      result = result.filter((c) => c.machineId === machineId);
    }

    if (q) {
      const asNum = Number(q);
      const lq = q.toLowerCase();
      result = result.filter(
        (c) =>
          c.drugName.toLowerCase().includes(lq) ||
          (c.drugCode?.toLowerCase().includes(lq)) ||
          (Number.isFinite(asNum) && c.cassetteNumber === asNum)
      );
    }

    if (status !== "ALL") {
      if (status === "REFILL") {
        result = result.filter((c) => {
          const s = getCassetteStatus(c);
          return s === "REFILL" || (s === "REVIEW" && c.currentInventory <= c.refillThreshold);
        });
      } else {
        result = result.filter((c) => getCassetteStatus(c) === status);
      }
    }

    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sort) {
        case "inventory":
          return a.currentInventory - b.currentInventory;
        case "shortage":
          return (a.currentInventory - a.refillThreshold) - (b.currentInventory - b.refillThreshold);
        case "cassette_desc":
          if (a.machine.name !== b.machine.name) return b.machine.name.localeCompare(a.machine.name);
          return b.cassetteNumber - a.cassetteNumber;
        case "drugCode_asc":
          return (a.drugCode ?? "").localeCompare(b.drugCode ?? "");
        case "drugCode_desc":
          return (b.drugCode ?? "").localeCompare(a.drugCode ?? "");
        case "drugName_asc":
          return a.drugName.localeCompare(b.drugName);
        case "drugName_desc":
          return b.drugName.localeCompare(a.drugName);
        default: // cassette / cassette_asc
          if (a.machine.name !== b.machine.name) return a.machine.name.localeCompare(b.machine.name);
          return a.cassetteNumber - b.cassetteNumber;
      }
    });
    return sorted;
  }, [rows, q, status, sort, machineId]);

  function toggleSort(col: string) {
    setSort((prev) => {
      if (prev === `${col}_asc`) return `${col}_desc`;
      if (prev === `${col}_desc`) return "cassette";
      return `${col}_asc`;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">
          전체 재고{" "}
          <span className="text-base font-normal text-slate-400">({filtered.length})</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/today" className="btn-secondary btn-xs sm:text-sm sm:px-4 sm:py-2">보충 필요</Link>
          <Link href="/analysis" className="btn-secondary btn-xs sm:text-sm sm:px-4 sm:py-2">사용량 분석</Link>
          <Link href="/stocktake" className="btn-secondary btn-xs sm:text-sm sm:px-4 sm:py-2">재고조사</Link>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium transition sm:px-4 sm:py-2 " +
                (status === f.key
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            {machines.length > 1 && (
              <select className="input flex-1 sm:flex-none" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">전체 장비</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m._count?.cassettes ?? 0})
                  </option>
                ))}
              </select>
            )}
            <select
              className="input flex-1 sm:flex-none"
              value={COL_SORT_KEYS.has(sort) ? "" : sort}
              onChange={(e) => { if (e.target.value) setSort(e.target.value); }}
            >
              <option value="" disabled>정렬 기준</option>
              {SPECIAL_SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex w-full items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 cursor-text sm:w-64">
            <svg className="shrink-0 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="카세트번호 · 약품명 · 약품코드"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400">조건에 맞는 카세트가 없습니다.</div>
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-auto sm:max-h-[calc(100vh-280px)]">
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh col="cassette" sort={sort} onToggle={toggleSort}>카세트</SortTh>
                  <SortTh col="drugCode" sort={sort} onToggle={toggleSort}>약품코드</SortTh>
                  <SortTh col="drugName" sort={sort} onToggle={toggleSort}>약품명</SortTh>
                  <th className="num">현재고</th>
                  <th className="num">보충기준</th>
                  <th className="num">포장</th>
                  <th className="num">권장</th>
                  <th className="center">상태</th>
                  <th className="center">작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const rec = getRecommendation(c);
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">
                        {machines.length > 1 && (
                          <span className="mr-1 text-xs text-slate-400">{c.machine.name}</span>
                        )}
                        #{c.cassetteNumber}
                      </td>
                      <td className="text-slate-500 text-sm">{c.drugCode ?? "—"}</td>
                      <td className="font-medium">{c.drugName}</td>
                      <td className={"num font-semibold " + (rec.needsRefill ? "text-amber-700" : "")}>
                        {fmt(c.currentInventory)}
                      </td>
                      <td className="num text-slate-500">{fmt(c.refillThreshold)}</td>
                      <td className="num text-slate-500">{fmt(c.packageSize)}</td>
                      <td className="num">{rec.text}</td>
                      <td className="text-center">
                        <StatusBadge cassette={c} />
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-2">
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

      <AdjustModal cassette={adjustTarget} onClose={() => setAdjustTarget(null)} onDone={refresh} />
      <SettingsModal cassette={settingsTarget} onClose={() => setSettingsTarget(null)} onDone={refresh} />
    </div>
  );
}

function SortTh({ col, sort, onToggle, children }: {
  col: string; sort: string; onToggle: (col: string) => void; children: React.ReactNode;
}) {
  const asc = sort === `${col}_asc` || (col === "cassette" && sort === "cassette");
  const desc = sort === `${col}_desc`;
  return (
    <th className="cursor-pointer select-none hover:bg-slate-50 transition" onClick={() => onToggle(col)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {asc ? (
          <svg className="h-3 w-3 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        ) : desc ? (
          <svg className="h-3 w-3 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        ) : (
          <svg className="h-3 w-3 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15M8.25 9L12 5.25 15.75 9" />
          </svg>
        )}
      </span>
    </th>
  );
}
