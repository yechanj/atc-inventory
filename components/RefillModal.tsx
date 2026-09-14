"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { apiFetch, fmt } from "@/lib/client";
import { getRecommendation } from "@/lib/status";
import type { Cassette } from "@/lib/types";

type Mode = "package" | "direct";

export function RefillModal({
  cassette,
  onClose,
  onDone,
}: {
  cassette: Cassette | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("package");
  const [packages, setPackages] = useState(0);
  const [direct, setDirect] = useState("");
  const [saveAsRecommended, setSaveAsRecommended] = useState(false);
  const [loading, setLoading] = useState(false);

  const key = cassette?.id ?? "";
  useEffect(() => {
    if (!cassette) return;
    setMode(cassette.packageSize > 1 ? "package" : "direct");
    setPackages(cassette.recommendedPackages ?? 0);
    setDirect("");
    setSaveAsRecommended(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cassette) return null;

  const rec = getRecommendation(cassette);

  const quantity =
    mode === "package"
      ? packages > 0 ? packages * cassette.packageSize : 0
      : (() => { const d = Number(direct); return Number.isFinite(d) && d > 0 ? d : 0; })();

  const projected = cassette.currentInventory + quantity;

  async function submit() {
    if (loading) return;
    if (!(quantity > 0)) {
      toast("보충 수량을 입력하세요.", "error");
      return;
    }
    setLoading(true);
    try {
      await apiFetch(`/api/cassettes/${cassette!.id}/refill`, {
        method: "POST",
        body: JSON.stringify({
          quantity,
          memo:
            mode === "package"
              ? `${packages}통 × ${cassette!.packageSize}`
              : "직접 수량 입력",
          ...(mode === "package" && saveAsRecommended && { recommendedPackages: packages }),
        }),
      });
      toast(`보충 완료: +${fmt(quantity)}정`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={!!cassette} onClose={onClose} title={`${cassette.drugName} 보충`}>
      <div className="space-y-1 text-sm">
        <Row label="카세트" value={`#${cassette.cassetteNumber} (${cassette.machine.name})`} />
        <Row label="현재고" value={`${fmt(cassette.currentInventory)}정`} />
        <Row
          label="권장 보충량"
          value={
            rec.recommendedPackages != null
              ? <span className="font-semibold text-brand-700">{rec.recommendedPackages}통</span>
              : <span className="text-slate-400">미설정</span>
          }
        />
      </div>

      <div className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
        <TabBtn active={mode === "package"} onClick={() => setMode("package")}>
          통(포장) 단위
        </TabBtn>
        <TabBtn active={mode === "direct"} onClick={() => setMode("direct")}>
          직접 수량 입력
        </TabBtn>
      </div>

      <div className="mt-3">
        {mode === "package" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden">
                <button
                  type="button"
                  className="px-3 py-2 text-slate-600 hover:bg-slate-100 transition text-lg font-medium disabled:opacity-30"
                  onClick={() => setPackages((p) => Math.max(0, p - 1))}
                  disabled={packages <= 0}
                >
                  −
                </button>
                <input
                  className="w-16 text-center text-base font-semibold outline-none py-2 bg-white"
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
                  className="px-3 py-2 text-slate-600 hover:bg-slate-100 transition text-lg font-medium"
                  onClick={() => setPackages((p) => p + 1)}
                >
                  +
                </button>
              </div>
              <span className="text-sm text-slate-500">
                통 × {fmt(cassette.packageSize)}정
                {quantity > 0 && (
                  <> = <b className="text-slate-800">{fmt(quantity)}정</b></>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              className="input w-28 num"
              type="number"
              min={0}
              value={direct}
              onChange={(e) => setDirect(e.target.value)}
              autoFocus
            />
            <span className="text-sm text-slate-500">정 (PTP 낱알 등)</span>
          </div>
        )}
      </div>

      {quantity > 0 && (
        <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
          반영 후 예상재고:{" "}
          <span className="font-semibold">
            {fmt(cassette.currentInventory)} → {fmt(projected)}정
          </span>
        </div>
      )}

      {mode === "package" && packages > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saveAsRecommended}
            onChange={(e) => setSaveAsRecommended(e.target.checked)}
            className="rounded"
          />
          이번 보충량({packages}통)을 이 카세트의 권장 보충량으로 저장
        </label>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose} disabled={loading}>
          취소
        </button>
        <button className="btn-primary" onClick={submit} disabled={loading || !(quantity > 0)}>
          {loading ? "처리 중…" : "보충 완료"}
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 rounded px-3 py-1.5 font-medium transition " +
        (active ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")
      }
    >
      {children}
    </button>
  );
}
