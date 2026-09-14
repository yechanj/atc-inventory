"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, fmt } from "@/lib/client";
import { useToast } from "@/components/Toast";
import { ConfirmModal } from "@/components/Modal";
import type { Cassette, Machine } from "@/lib/types";

export default function StocktakePage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Cassette[] | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);

  // 카세트 추가 폼
  const [showAdd, setShowAdd] = useState(false);
  const [addMachineId, setAddMachineId] = useState("");
  const [addNumber, setAddNumber] = useState("");
  const [addDrugName, setAddDrugName] = useState("");
  const [addDrugCode, setAddDrugCode] = useState("");
  const [addInventory, setAddInventory] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<Cassette[]>("/api/stocktake");
      setRows(data);
      setValues({});
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
    apiFetch<Machine[]>("/api/machines").then((m) => {
      setMachines(m);
      if (m.length > 0) setAddMachineId(m[0].id);
    }).catch(() => {});
  }, [load]);

  const entries = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((c) => {
        const raw = values[c.id];
        if (raw == null || raw === "") return null;
        const actual = Number(raw);
        if (!Number.isFinite(actual) || actual < 0) return null;
        if (actual === c.currentInventory) return null;
        return { cassetteId: c.id, actualQuantity: actual, diff: actual - c.currentInventory };
      })
      .filter(Boolean) as { cassetteId: string; actualQuantity: number; diff: number }[];
  }, [rows, values]);

  async function submit() {
    if (saving || entries.length === 0) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ updated: number }>("/api/stocktake", {
        method: "POST",
        body: JSON.stringify({
          entries: entries.map((e) => ({ cassetteId: e.cassetteId, actualQuantity: e.actualQuantity })),
          memo: "재고조사 반영",
        }),
      });
      toast(`재고조사 반영 완료 — ${res.updated}개 카세트 보정`, "success");
      setConfirm(false);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
      setConfirm(false);
    } finally {
      setSaving(false);
    }
  }

  async function addCassette() {
    if (addLoading) return;
    const num = Number(addNumber);
    const inv = Number(addInventory);
    if (!addMachineId) { toast("장비를 선택하세요.", "error"); return; }
    if (!Number.isFinite(num) || num <= 0) { toast("카세트 번호를 입력하세요.", "error"); return; }
    if (!Number.isFinite(inv) || inv < 0) { toast("실제재고를 입력하세요.", "error"); return; }
    setAddLoading(true);
    try {
      await apiFetch("/api/cassettes", {
        method: "POST",
        body: JSON.stringify({
          machineId: addMachineId,
          cassetteNumber: num,
          drugName: addDrugName.trim() || "(미등록)",
          drugCode: addDrugCode.trim() || null,
          currentInventory: inv,
        }),
      });
      toast(`카세트 #${num} 등록 완료`, "success");
      setAddNumber("");
      setAddDrugName("");
      setAddDrugCode("");
      setAddInventory("");
      setShowAdd(false);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAddLoading(false);
    }
  }

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (!onlyDiff) return rows;
    return rows.filter((c) => {
      const raw = values[c.id];
      return raw != null && raw !== "" && Number(raw) !== c.currentInventory;
    });
  }, [rows, values, onlyDiff]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">재고조사 모드</h1>
          <p className="text-xs text-slate-400">
            실제 카세트를 세어 실제재고를 입력하세요. 입력한 값만 일괄 보정됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "취소" : "+ 카세트 추가"}
          </button>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            차이나는 것만
          </label>
          <button
            className="btn-primary"
            onClick={() => setConfirm(true)}
            disabled={entries.length === 0}
          >
            재고조사 반영 ({entries.length})
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-5">
          <p className="mb-4 text-sm font-semibold text-slate-700">
            미등록 카세트 추가
            <span className="ml-2 text-xs font-normal text-slate-400">
              업로드 시 카세트번호로 자동 연동됩니다
            </span>
          </p>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
            {machines.length > 1 && (
              <Field label="장비">
                <select
                  className="input"
                  value={addMachineId}
                  onChange={(e) => setAddMachineId(e.target.value)}
                >
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="카세트번호">
              <input
                className="input w-32 num"
                type="number"
                min={1}
                placeholder="번호"
                value={addNumber}
                onChange={(e) => setAddNumber(e.target.value)}
              />
            </Field>
            <Field label="약품코드 (선택)">
              <input
                className="input w-52"
                placeholder="모르면 비워두세요"
                value={addDrugCode}
                onChange={(e) => setAddDrugCode(e.target.value)}
              />
            </Field>
            <Field label="약품명 (선택)">
              <input
                className="input w-60"
                placeholder="모르면 비워두세요"
                value={addDrugName}
                onChange={(e) => setAddDrugName(e.target.value)}
              />
            </Field>
            <Field label="실제재고 (정)">
              <input
                className="input w-32 num"
                type="number"
                min={0}
                placeholder="0"
                value={addInventory}
                onChange={(e) => setAddInventory(e.target.value)}
              />
            </Field>
            <button
              className="btn-primary mb-0.5"
              onClick={addCassette}
              disabled={addLoading}
            >
              {addLoading ? "등록 중…" : "등록"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-rose-600">불러오기 실패: {error}</div>
        ) : rows === null ? (
          <div className="p-8 text-center text-slate-400">불러오는 중…</div>
        ) : (
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>카세트</th>
                  <th>약품</th>
                  <th className="num">계산재고</th>
                  <th className="num">실제재고</th>
                  <th className="num">차이</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((c) => {
                  const raw = values[c.id] ?? "";
                  const actual = Number(raw);
                  const hasVal = raw !== "" && Number.isFinite(actual);
                  const diff = hasVal ? actual - c.currentInventory : null;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">
                        {c.machine.name} #{c.cassetteNumber}
                      </td>
                      <td>
                        {c.drugName}
                        {c.drugName === "(미등록)" && (
                          <span className="ml-1 text-xs text-slate-400">(약품 미연동)</span>
                        )}
                      </td>
                      <td className="num text-slate-500">{fmt(c.currentInventory)}</td>
                      <td className="num">
                        <input
                          className="input w-24 num"
                          type="number"
                          min={0}
                          value={raw}
                          placeholder="—"
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [c.id]: e.target.value }))
                          }
                        />
                      </td>
                      <td
                        className={
                          "num font-medium " +
                          (diff == null || diff === 0
                            ? "text-slate-400"
                            : diff > 0
                            ? "text-emerald-600"
                            : "text-rose-600")
                        }
                      >
                        {diff == null ? "-" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={submit}
        title="재고조사 일괄 반영"
        danger
        loading={saving}
        confirmLabel="반영하기"
        message={
          <>
            입력한 <b>{entries.length}개</b> 카세트의 현재고를 실제재고로 덮어씁니다.
            <br />
            모든 차이는 변동 기록(재고조사)에 저장됩니다. 계속하시겠습니까?
          </>
        }
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}
