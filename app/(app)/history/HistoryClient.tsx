"use client";

import { useMemo, useState } from "react";
import { fmt, fmtDateTime } from "@/lib/client";
import type { HistoryRow } from "@/lib/types";

const TYPES = [
  { key: "ALL", label: "전체" },
  { key: "USAGE", label: "사용량" },
  { key: "REFILL", label: "보충" },
  { key: "MANUAL_ADJUSTMENT", label: "실재고 보정" },
  { key: "STOCKTAKE", label: "재고조사" },
  { key: "INITIAL_INVENTORY", label: "초기재고" },
];

const TYPE_LABEL: Record<string, string> = {
  USAGE: "사용량",
  REFILL: "보충",
  MANUAL_ADJUSTMENT: "실재고 보정",
  STOCKTAKE: "재고조사",
  INITIAL_INVENTORY: "초기재고",
};

const TYPE_BADGE: Record<string, string> = {
  USAGE: "bg-rose-50 text-rose-700",
  REFILL: "bg-emerald-50 text-emerald-700",
  MANUAL_ADJUSTMENT: "bg-blue-50 text-blue-700",
  STOCKTAKE: "bg-violet-50 text-violet-700",
  INITIAL_INVENTORY: "bg-slate-100 text-slate-600",
};

export function HistoryClient({ initialRows }: { initialRows: HistoryRow[] }) {
  const [type, setType] = useState("ALL");

  const rows = useMemo(
    () => (type === "ALL" ? initialRows : initialRows.filter((h) => h.type === type)),
    [initialRows, type]
  );

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">재고 변동 기록</h1>

      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={
              "btn-xs rounded-md font-medium " +
              (type === t.key
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
            }
          >
            {t.label}
          </button>
        ))}
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
                    <td className="max-w-xs truncate text-xs text-slate-400" title={h.memo ?? ""}>
                      {h.memo ?? ""}
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
