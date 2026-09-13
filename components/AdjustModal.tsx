"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { apiFetch, fmt } from "@/lib/client";
import type { Cassette } from "@/lib/types";

export function AdjustModal({
  cassette,
  onClose,
  onDone,
}: {
  cassette: Cassette | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [actual, setActual] = useState("");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);

  const key = cassette?.id ?? "";
  useEffect(() => {
    if (cassette) {
      setActual(String(cassette.currentInventory));
      setMemo("");
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cassette) return null;
  const actualNum = Number(actual);
  const valid = Number.isFinite(actualNum) && actualNum >= 0;
  const diff = valid ? actualNum - cassette.currentInventory : 0;

  async function submit() {
    if (loading) return;
    if (!valid) {
      toast("실재고는 0 이상의 숫자여야 합니다.", "error");
      return;
    }
    setLoading(true);
    try {
      await apiFetch(`/api/cassettes/${cassette!.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ actualQuantity: actualNum, memo: memo || undefined }),
      });
      toast(`실재고 보정 완료: ${fmt(cassette!.currentInventory)} → ${fmt(actualNum)}`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={!!cassette} onClose={onClose} title={`${cassette.drugName} 실재고 보정`}>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">카세트</span>
          <span>#{cassette.cassetteNumber} ({cassette.machine.name})</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">현재 계산재고</span>
          <span className="font-semibold">{fmt(cassette.currentInventory)}정</span>
        </div>
      </div>

      <div className="mt-4">
        <label className="label">실제로 센 수량</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            className="input w-32 num"
            type="number"
            min={0}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            autoFocus
          />
          <span className="text-sm text-slate-500">정</span>
          {valid && diff !== 0 && (
            <span
              className={
                "text-sm font-medium " + (diff > 0 ? "text-emerald-600" : "text-rose-600")
              }
            >
              차이 {diff > 0 ? "+" : ""}
              {fmt(diff)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <label className="label">메모 (선택)</label>
        <input
          className="input mt-1 w-full"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="예: 카세트 직접 계수"
        />
      </div>

      <p className="mt-3 text-xs text-slate-400">
        보정 내역은 변동 기록(실재고 보정)에 저장됩니다.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose} disabled={loading}>
          취소
        </button>
        <button className="btn-primary" onClick={submit} disabled={loading || !valid}>
          {loading ? "처리 중…" : "보정 확인"}
        </button>
      </div>
    </Modal>
  );
}
