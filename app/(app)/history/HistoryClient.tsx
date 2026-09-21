"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { apiFetch, fmt, fmtDateTime } from "@/lib/client";
import type { HistoryRow } from "@/lib/types";

const TYPES = [
  { key: "ALL", label: "전체" },
  { key: "USAGE", label: "사용량" },
  { key: "MDB_AUTO", label: "자동차감" },
  { key: "REFILL", label: "보충" },
  { key: "MANUAL_ADJUSTMENT", label: "실재고 보정" },
  { key: "STOCKTAKE", label: "재고조사" },
  { key: "INITIAL_INVENTORY", label: "초기재고" },
];

const TYPE_LABEL: Record<string, string> = {
  USAGE: "사용량",
  MDB_AUTO: "자동차감",
  REFILL: "보충",
  MANUAL_ADJUSTMENT: "실재고 보정",
  STOCKTAKE: "재고조사",
  INITIAL_INVENTORY: "초기재고",
};

const TYPE_BADGE: Record<string, string> = {
  USAGE: "bg-rose-50 text-rose-700",
  MDB_AUTO: "bg-orange-50 text-orange-700",
  REFILL: "bg-emerald-50 text-emerald-700",
  MANUAL_ADJUSTMENT: "bg-blue-50 text-blue-700",
  STOCKTAKE: "bg-violet-50 text-violet-700",
  INITIAL_INVENTORY: "bg-slate-100 text-slate-600",
};

function MemoCell({
  memo,
  isEditing,
  onEdit,
  onSave,
  onCancel,
}: {
  memo: string | null;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (memo: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(memo ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setValue(memo ?? "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isEditing]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(value.trim() || null);
    } finally {
      setSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          className="input flex-1 text-xs py-0.5 min-w-0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onCancel();
          }}
        />
        <button
          title="저장"
          disabled={saving}
          onClick={handleSave}
          className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-40"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </button>
        <button
          title="취소"
          onClick={onCancel}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 transition"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <span className="truncate text-xs text-slate-400" title={memo ?? ""}>{memo || "—"}</span>
      <button
        title="메모 편집"
        onClick={onEdit}
        className="shrink-0 rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-500 transition"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </button>
    </div>
  );
}

export function HistoryClient({ initialRows }: { initialRows: HistoryRow[] }) {
  const [localRows, setLocalRows] = useState<HistoryRow[]>(initialRows);
  const [type, setType] = useState("ALL");
  const [q, setQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!filterOpen) return;
    function onOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [filterOpen]);

  async function saveMemo(id: string, memo: string | null) {
    await apiFetch(`/api/history/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ memo }),
    });
    setLocalRows((prev) =>
      prev.map((h) => (h.id === id ? { ...h, memo } : h))
    );
    setEditingId(null);
  }

  const rows = useMemo(() => {
    let result = type === "ALL" ? localRows : localRows.filter((h) => h.type === type);
    if (q.trim()) {
      const lq = q.trim().toLowerCase();
      const asNum = Number(lq);
      result = result.filter((h) =>
        h.cassette.drugName.toLowerCase().includes(lq) ||
        (h.cassette.drugCode?.toLowerCase().includes(lq) ?? false) ||
        (Number.isFinite(asNum) && h.cassette.cassetteNumber === asNum)
      );
    }
    return result;
  }, [localRows, type, q]);

  const activeLabel = TYPES.find((t) => t.key === type)?.label ?? "전체";

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">재고 변동 기록</h1>

      <div className="flex items-center gap-2">
        {/* 검색창 */}
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
          <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="약품명 · 약품코드 · 카세트번호"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="text-slate-400 hover:text-slate-600 transition" onClick={() => setQ("")}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 필터 드롭다운 */}
        <div className="relative shrink-0" ref={filterRef}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ring-1 " +
              (type !== "ALL"
                ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50")
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18M7 9.5h10M11 14.5h2" />
            </svg>
            {type !== "ALL" && <span>{activeLabel}</span>}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-40 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setType(t.key); setFilterOpen(false); }}
                  className={
                    "flex w-full items-center justify-between px-4 py-2 text-sm transition " +
                    (type === t.key ? "font-semibold text-brand-600" : "text-slate-600 hover:bg-slate-50")
                  }
                >
                  {t.label}
                  {type === t.key && (
                    <svg className="h-3.5 w-3.5 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400">기록이 없습니다.</div>
        ) : (
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>카세트</th>
                  <th>약품</th>
                  <th>유형</th>
                  <th className="num">이전</th>
                  <th className="num">변화</th>
                  <th className="num">이후</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td className="text-slate-500">{fmtDateTime(h.createdAt)}</td>
                    <td className="font-medium">
                      {h.cassette.machine.name} #{h.cassette.cassetteNumber}
                    </td>
                    <td>{h.cassette.drugName}</td>
                    <td>
                      <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + (TYPE_BADGE[h.type] ?? "bg-slate-100 text-slate-600")}>
                        {TYPE_LABEL[h.type] ?? h.type}
                      </span>
                    </td>
                    <td className="num text-slate-500">{fmt(h.quantityBefore)}</td>
                    <td className={"num font-semibold " + (h.changeQuantity > 0 ? "text-emerald-600" : h.changeQuantity < 0 ? "text-rose-600" : "text-slate-400")}>
                      {h.changeQuantity > 0 ? "+" : ""}{fmt(h.changeQuantity)}
                    </td>
                    <td className="num font-medium">{fmt(h.quantityAfter)}</td>
                    <td className="max-w-xs">
                      <MemoCell
                        memo={h.memo ?? null}
                        isEditing={editingId === h.id}
                        onEdit={() => setEditingId(h.id)}
                        onSave={(memo) => saveMemo(h.id, memo)}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
