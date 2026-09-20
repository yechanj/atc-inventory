"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, fmt } from "@/lib/client";
import { getRecommendation, getCassetteStatus, STATUS_BADGE, STATUS_LABEL } from "@/lib/status";
import { useToast } from "@/components/Toast";
import { SettingsModal } from "@/components/SettingsModal";
import type { Cassette } from "@/lib/types";

type RowMode = "통" | "낱알";
type RowState = { mode: RowMode; val: number };

function initRowState(c: Cassette): RowState {
  // FULL 모드: 만충량 설정 + 권장 보충량 미설정
  if (c.fullCapacity != null && c.recommendedPackages == null) {
    return { mode: "낱알", val: Math.max(0, c.fullCapacity - c.currentInventory) };
  }
  const mode: RowMode = c.packageSize > 1 ? "통" : "낱알";
  return { mode, val: mode === "통" ? (c.recommendedPackages ?? 1) : 0 };
}

function rowQty(state: RowState, c: Cassette) {
  return state.mode === "통" ? state.val * c.packageSize : state.val;
}

export function TodayClient({ initialRows }: { initialRows: Cassette[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Cassette[]>(initialRows);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(initialRows.map((c) => [c.id, initRowState(c)]))
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<Cassette | null>(null);
  const allCheckRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<Cassette[]>("/api/cassettes?status=REFILL&sort=cassette");
      setRows(data);
      setRowStates((prev) => {
        const next: Record<string, RowState> = {};
        for (const c of data) next[c.id] = prev[c.id] ?? initRowState(c);
        return next;
      });
      setChecked((prev) => {
        const ids = new Set(data.map((c) => c.id));
        const next = new Set([...prev].filter((id) => ids.has(id)));
        return next;
      });
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, []);

  // 전체선택 체크박스 indeterminate 처리
  useEffect(() => {
    if (!allCheckRef.current) return;
    allCheckRef.current.indeterminate = checked.size > 0 && checked.size < rows.length;
  }, [checked.size, rows.length]);

  function patchRow(id: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleMode(c: Cassette) {
    const cur = rowStates[c.id];
    if (!cur) return;
    const next: RowMode = cur.mode === "통" ? "낱알" : "통";
    patchRow(c.id, { mode: next, val: next === "통" ? (c.recommendedPackages ?? 1) : 0 });
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === rows.length) setChecked(new Set());
    else setChecked(new Set(rows.map((c) => c.id)));
  }

  const checkedCount = checked.size;
  const validChecked = rows.filter((c) => {
    if (!checked.has(c.id)) return false;
    const state = rowStates[c.id] ?? initRowState(c);
    return rowQty(state, c) > 0;
  });

  async function submitBulk() {
    if (bulkLoading || validChecked.length === 0) return;
    setBulkLoading(true);
    let ok = 0;
    const errs: string[] = [];
    for (const c of validChecked) {
      const state = rowStates[c.id] ?? initRowState(c);
      const quantity = rowQty(state, c);
      try {
        await apiFetch(`/api/cassettes/${c.id}/refill`, {
          method: "POST",
          body: JSON.stringify({
            quantity,
            memo: state.mode === "통" ? `${state.val}통 × ${c.packageSize}` : "직접 수량 입력",
          }),
        });
        ok++;
      } catch (e) {
        errs.push(`${c.drugName}: ${(e as Error).message}`);
      }
    }
    if (ok > 0) toast(`${ok}개 보충 완료`, "success");
    if (errs.length > 0) toast(errs.join(" / "), "error");
    setBulkLoading(false);
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">
          보충 필요{" "}
          <span className="text-brand-700">{rows.length}개</span>
        </h1>
        <button
          className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
          onClick={submitBulk}
          disabled={bulkLoading || validChecked.length === 0}
        >
          {bulkLoading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          )}
          보충{checkedCount > 0 && ` (${checkedCount}개)`}
        </button>
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-2xl">✅</div>
            <div className="mt-2 text-slate-500">보충이 필요한 카세트가 없습니다.</div>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-180px)] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      ref={allCheckRef}
                      type="checkbox"
                      checked={checked.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th>카세트</th>
                  <th>약품코드</th>
                  <th>약품</th>
                  <th className="num">현재고</th>
                  <th className="num">기준재고</th>
                  <th className="num">권장</th>
                  <th>보충량</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const rec = getRecommendation(c);
                  const status = getCassetteStatus(c);
                  const state = rowStates[c.id] ?? initRowState(c);
                  const quantity = rowQty(state, c);
                  const isChecked = checked.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={isChecked ? "bg-brand-50/60" : undefined}
                      onClick={(e) => {
                        // 설정 버튼 / 입력 / 토글 클릭은 체크 무시
                        const t = e.target as HTMLElement;
                        if (t.closest("button, input")) return;
                        toggleCheck(c.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(c.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="font-medium">
                        {c.machine.name} #{c.cassetteNumber}
                      </td>
                      <td className="text-slate-500 text-sm">{c.drugCode ?? "—"}</td>
                      <td>
                        {c.drugName}
                        {status === "REVIEW" && (
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE.REVIEW}`}>
                            {STATUS_LABEL.REVIEW}
                          </span>
                        )}
                      </td>
                      <td className="num font-semibold text-amber-700">{fmt(c.currentInventory)}</td>
                      <td className="num text-slate-500">{fmt(c.refillThreshold)}</td>
                      <td className="num font-medium">{rec.text}</td>

                      {/* 보충량 인라인 */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleMode(c)}
                            className={
                              "rounded-md px-2 py-1 text-xs font-semibold ring-1 transition select-none " +
                              (state.mode === "통"
                                ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700"
                                : "bg-slate-100 text-slate-600 ring-slate-300 hover:bg-slate-200")
                            }
                          >
                            {state.mode}
                          </button>
                          <input
                            type="number"
                            min={0}
                            className="input w-14 num py-1 text-sm"
                            value={state.val === 0 ? "" : state.val}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              patchRow(c.id, { val: Number.isFinite(v) && v >= 0 ? v : 0 });
                            }}
                          />
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            {state.mode === "통"
                              ? `×${fmt(c.packageSize)}정${quantity > 0 ? ` =${fmt(quantity)}` : ""}`
                              : "정"}
                          </span>
                        </div>
                      </td>

                      {/* 설정 버튼 */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          title="카세트 설정"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                          onClick={() => setSettingsTarget(c)}
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.383.929-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SettingsModal
        cassette={settingsTarget}
        onClose={() => setSettingsTarget(null)}
        onDone={refresh}
      />
    </div>
  );
}
