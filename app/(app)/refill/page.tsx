"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, fmt, fmtDateTime } from "@/lib/client";
import { useToast } from "@/components/Toast";
import type { Cassette, HistoryRow } from "@/lib/types";

type Mode = "package" | "direct" | "full";

export default function RefillPage() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cassette[] | null>(null);
  const [selected, setSelected] = useState<Cassette | null>(null);
  const [mode, setMode] = useState<Mode>("package");
  const [packages, setPackages] = useState(1);
  const [direct, setDirect] = useState("");
  const [saveAsRecommended, setSaveAsRecommended] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults(null); return; }
    debounce.current = setTimeout(async () => {
      try {
        const data = await apiFetch<Cassette[]>(`/api/cassettes?q=${encodeURIComponent(q)}&sort=cassette`);
        setResults(data);
        setHighlightedIdx(-1);
        itemRefs.current = [];
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
    setMode(c.fullCapacity != null ? "full" : c.packageSize > 1 ? "package" : "direct");
    setPackages(c.recommendedPackages ?? 1);
    setDirect("");
    setSaveAsRecommended(false);
  }

  function clearSelection() {
    setSelected(null);
    setResults(null);
  }

  const quantity =
    mode === "full" ? 1 // 서버에서 계산 — 버튼 활성화용 더미값
    : mode === "package"
      ? selected && packages > 0 ? packages * selected.packageSize : 0
      : (() => { const d = Number(direct); return Number.isFinite(d) && d > 0 ? d : 0; })();

  async function deleteEntry(h: HistoryRow) {
    if (!window.confirm(`보충 이력을 삭제하시겠습니까?\n${h.cassette.drugName} +${fmt(h.changeQuantity)}정\n\n현재고도 함께 되돌아갑니다.`)) return;
    setDeletingId(h.id);
    try {
      await apiFetch(`/api/history/${h.id}`, { method: "DELETE" });
      toast("삭제 완료", "success");
      loadHistory();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit() {
    if (!selected || loading || !(quantity > 0)) return;
    setLoading(true);
    try {
      const body =
        mode === "full"
          ? { fillToCapacity: true }
          : {
              quantity,
              memo: mode === "package" ? `${packages}통 × ${selected.packageSize}` : "직접 수량 입력",
              ...(mode === "package" && saveAsRecommended && { recommendedPackages: packages }),
            };
      const result = await apiFetch<{ before: number; after: number }>(
        `/api/cassettes/${selected.id}/refill`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const added = result.after - result.before;
      toast(`보충 완료: ${selected.drugName} +${fmt(added)}정`, "success");
      setSelected(null);
      setQ("");
      setResults(null);
      setPackages(1);
      setDirect("");
      setSaveAsRecommended(false);
      loadHistory();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
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
                onKeyDown={(e) => {
                  if (!results || results.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedIdx((i) => {
                      const next = Math.min(i + 1, results.length - 1);
                      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
                      return next;
                    });
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedIdx((i) => {
                      const next = Math.max(i - 1, 0);
                      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
                      return next;
                    });
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const target = results[highlightedIdx] ?? results[0];
                    if (target) selectCassette(target);
                  } else if (e.key === "Escape") {
                    setQ(""); setResults(null); setHighlightedIdx(-1);
                  }
                }}
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
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
                  {results.map((c, idx) => (
                    <li key={c.id}>
                      <button
                        ref={(el) => { itemRefs.current[idx] = el; }}
                        className={
                          "w-full flex items-center gap-3 px-4 py-3 text-left transition " +
                          (idx === highlightedIdx ? "bg-brand-50" : "hover:bg-slate-50")
                        }
                        onClick={() => selectCassette(c)}
                        onMouseEnter={() => setHighlightedIdx(idx)}
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
            {/* 선택된 카세트 정보 */}
            <div className="flex items-start justify-between rounded-lg bg-slate-50 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-800">{selected.drugName}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {selected.machine.name} #{selected.cassetteNumber}
                  {selected.drugCode && ` · ${selected.drugCode}`}
                  {` · ${fmt(selected.packageSize)}정/통`}
                </p>
              </div>
              <button
                className="text-xs text-slate-400 hover:text-slate-600 transition"
                onClick={clearSelection}
              >
                변경
              </button>
            </div>

            {/* 입력 모드 탭 */}
            <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
              <button
                onClick={() => setMode("package")}
                className={
                  "flex-1 rounded px-3 py-1.5 font-medium transition " +
                  (mode === "package" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")
                }
              >
                통(포장) 단위
              </button>
              <button
                onClick={() => setMode("direct")}
                className={
                  "flex-1 rounded px-3 py-1.5 font-medium transition " +
                  (mode === "direct" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")
                }
              >
                직접 수량 입력
              </button>
              {selected.fullCapacity != null && (
                <button
                  onClick={() => setMode("full")}
                  className={
                    "flex-1 rounded px-3 py-1.5 font-medium transition " +
                    (mode === "full" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")
                  }
                >
                  만충 보충
                </button>
              )}
            </div>

            {/* 수량 입력 */}
            {mode === "package" ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <button
                    type="button"
                    className="px-3 py-2 text-lg font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-30"
                    onClick={() => setPackages((p) => Math.max(0, p - 1))}
                    disabled={packages <= 0}
                  >
                    −
                  </button>
                  <input
                    className="w-16 bg-white py-2 text-center text-base font-semibold outline-none"
                    type="number"
                    min={0}
                    value={packages === 0 ? "" : packages}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setPackages(Number.isFinite(v) && v >= 0 ? v : 0);
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
            ) : mode === "direct" ? (
              <div className="flex items-center gap-2">
                <input
                  className="input w-28 num"
                  type="number"
                  min={1}
                  value={direct}
                  onChange={(e) => setDirect(e.target.value)}
                  placeholder="수량"
                  autoFocus
                />
                <span className="text-sm text-slate-500">정 (PTP 낱알 등)</span>
              </div>
            ) : (
              <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
                만충량 <b>{fmt(selected.fullCapacity!)}정</b>으로 채웁니다.
                <span className="ml-2 text-brand-500 text-xs">현재고 기준 차이만큼 자동 계산됩니다.</span>
              </div>
            )}

            {/* 권장 보충량 미설정 시 저장 체크박스 */}
            {mode === "package" && packages > 0 && selected.recommendedPackages === null && (
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveAsRecommended}
                  onChange={(e) => setSaveAsRecommended(e.target.checked)}
                  className="rounded"
                />
                이번 보충량({packages}통)을 이 카세트의 권장 보충량으로 지정
              </label>
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
            <div className="max-h-[420px] overflow-y-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>카세트</th>
                    <th>약품</th>
                    <th className="num">수량</th>
                    <th>메모</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="text-xs text-slate-500">{fmtDateTime(h.createdAt)}</td>
                      <td className="text-sm">{h.cassette.machine.name} #{h.cassette.cassetteNumber}</td>
                      <td className="font-medium">{h.cassette.drugName}</td>
                      <td className="num font-semibold text-emerald-600">+{fmt(h.changeQuantity)}</td>
                      <td className="text-xs text-slate-400">{h.memo ?? ""}</td>
                      <td>
                        <button
                          title="삭제"
                          disabled={deletingId === h.id}
                          onClick={() => deleteEntry(h)}
                          className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition disabled:opacity-40"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
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
