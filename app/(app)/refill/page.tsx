"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, fmt, fmtDateTime } from "@/lib/client";
import { useToast } from "@/components/Toast";
import type { Cassette, HistoryRow } from "@/lib/types";

export default function RefillPage() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cassette[] | null>(null);
  const [selected, setSelected] = useState<Cassette | null>(null);
  const [packages, setPackages] = useState(1);
  const [direct, setDirect] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults(null); return; }
    debounce.current = setTimeout(async () => {
      try {
        const data = await apiFetch<Cassette[]>(`/api/cassettes?q=${encodeURIComponent(q)}&sort=cassette`);
        setResults(data);
      } catch {}
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [q]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<HistoryRow[]>("/api/history?type=REFILL&limit=50");
      setHistory(data);
    } catch {}
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  function selectCassette(c: Cassette) {
    setSelected(c);
    setPackages(c.recommendedPackages ?? 1);
    setDirect("");
  }

  function clearSelection() {
    setSelected(null);
    setResults(null);
  }

  const isSingleUnit = selected && selected.packageSize === 1;

  const quantity = selected
    ? isSingleUnit
      ? (() => { const d = Number(direct); return Number.isFinite(d) && d > 0 ? d : 0; })()
      : packages * selected.packageSize
    : 0;

  async function submit() {
    if (!selected || loading || !(quantity > 0)) return;
    setLoading(true);
    try {
      await apiFetch(`/api/cassettes/${selected.id}/refill`, {
        method: "POST",
        body: JSON.stringify({
          quantity,
          memo: isSingleUnit
            ? `직접 수량 입력`
            : `${packages}통 × ${selected.packageSize}`,
        }),
      });
      toast(`보충 완료: ${selected.drugName} +${fmt(quantity)}정`, "success");
      setSelected(null);
      setQ("");
      setResults(null);
      setPackages(1);
      setDirect("");
      loadHistory();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-bold tracking-tight">보충 입력</h1>

      <div className="card p-4 space-y-3">
        {!selected ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 cursor-text">
              <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="약품명 · 약품코드 · 카세트번호로 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              {q && (
                <button
                  className="text-slate-400 hover:text-slate-600 transition"
                  onClick={() => { setQ(""); setResults(null); }}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {results !== null && (
              results.length === 0 ? (
                <p className="text-sm text-slate-400 px-1">검색 결과가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
                        onClick={() => selectCassette(c)}
                      >
                        <span className="shrink-0 text-sm text-slate-400">
                          {c.machine.name} #{c.cassetteNumber}
                        </span>
                        <span className="font-medium">{c.drugName}</span>
                        {c.drugCode && (
                          <span className="text-xs text-slate-400">{c.drugCode}</span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-slate-400">
                          {fmt(c.packageSize)}정/통
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between rounded-lg bg-slate-50 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-800">{selected.drugName}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {selected.machine.name} #{selected.cassetteNumber}
                  {selected.drugCode && ` · ${selected.drugCode}`}
                  {!isSingleUnit && ` · ${fmt(selected.packageSize)}정/통`}
                </p>
              </div>
              <button
                className="text-xs text-slate-400 hover:text-slate-600 transition"
                onClick={clearSelection}
              >
                변경
              </button>
            </div>

            {isSingleUnit ? (
              <div className="flex items-center gap-3">
                <input
                  className="input w-28 num"
                  type="number"
                  min={1}
                  value={direct}
                  onChange={(e) => setDirect(e.target.value)}
                  placeholder="수량"
                  autoFocus
                />
                <span className="text-sm text-slate-500">정 입력</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <button
                    type="button"
                    className="px-3 py-2 text-lg font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-30"
                    onClick={() => setPackages((p) => Math.max(1, p - 1))}
                    disabled={packages <= 1}
                  >
                    −
                  </button>
                  <input
                    className="w-16 bg-white py-2 text-center text-base font-semibold outline-none"
                    type="number"
                    min={1}
                    value={packages}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setPackages(Number.isFinite(v) && v > 0 ? v : 1);
                    }}
                  />
                  <button
                    type="button"
                    className="px-3 py-2 text-lg font-medium text-slate-600 hover:bg-slate-100 transition"
                    onClick={() => setPackages((p) => p + 1)}
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-slate-600">
                  통 × {fmt(selected.packageSize)}정
                  {quantity > 0 && (
                    <> = <b className="text-slate-800">{fmt(quantity)}정</b></>
                  )}
                </span>
              </div>
            )}

            <button
              className="btn-primary w-full"
              onClick={submit}
              disabled={loading || !(quantity > 0)}
            >
              {loading ? "처리 중…" : "보충 기록"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-700">보충 이력</h2>
        <div className="card overflow-hidden">
          {history === null ? (
            <div className="p-6 text-center text-slate-400">불러오는 중…</div>
          ) : history.length === 0 ? (
            <div className="p-6 text-center text-slate-400">보충 이력이 없습니다.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>카세트</th>
                    <th>약품</th>
                    <th className="num">수량</th>
                    <th>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="text-xs text-slate-500">{fmtDateTime(h.createdAt)}</td>
                      <td className="text-sm">{h.cassette.machine.name} #{h.cassette.cassetteNumber}</td>
                      <td className="font-medium">{h.cassette.drugName}</td>
                      <td className="num font-semibold text-emerald-600">
                        +{fmt(h.changeQuantity)}
                      </td>
                      <td className="text-xs text-slate-400">{h.memo ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
