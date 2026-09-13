"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [packages, setPackages] = useState("");
  const [direct, setDirect] = useState("");
  const [loading, setLoading] = useState(false);

  const rec = cassette ? getRecommendation(cassette) : null;

  // 모달이 열릴 때(카세트가 바뀔 때) 권장 포장수를 기본값으로 채운다.
  const key = cassette?.id ?? "";
  useEffect(() => {
    if (!cassette) return;
    const r = getRecommendation(cassette);
    setMode(cassette.packageSize > 1 ? "package" : "direct");
    setPackages(r.packages > 0 ? String(r.packages) : "");
    setDirect(r.shortage > 0 ? String(Math.round(r.shortage)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const quantity = useMemo(() => {
    if (!cassette) return 0;
    if (mode === "package") {
      const p = Number(packages);
      return Number.isFinite(p) && p > 0 ? p * cassette.packageSize : 0;
    }
    const d = Number(direct);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [cassette, mode, packages, direct]);

  if (!cassette) return null;
  const projected = cassette.currentInventory + quantity;

  async function submit() {
    if (loading) return; // 중복 클릭 방지
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
              ? `${packages}포장 × ${cassette!.packageSize}`
              : "직접 수량 입력",
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
        <Row label="포장단위" value={`${fmt(cassette.packageSize)}정`} />
        <Row label="목표재고" value={`${fmt(cassette.targetInventory)}정`} />
        {rec && rec.text !== "-" && (
          <Row label="권장 보충" value={<span className="font-semibold text-brand-700">{rec.text} ({fmt(rec.shortage)}정)</span>} />
        )}
      </div>

      <div className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
        <TabBtn active={mode === "package"} onClick={() => setMode("package")}>
          포장단위 보충
        </TabBtn>
        <TabBtn active={mode === "direct"} onClick={() => setMode("direct")}>
          직접 수량 입력
        </TabBtn>
      </div>

      <div className="mt-3">
        {mode === "package" ? (
          <div className="flex items-center gap-2">
            <input
              className="input w-24 num"
              type="number"
              min={0}
              value={packages}
              onChange={(e) => setPackages(e.target.value)}
              autoFocus
            />
            <span className="text-sm text-slate-500">
              포장 × {fmt(cassette.packageSize)}정 ={" "}
              <b className="text-slate-800">{fmt(quantity)}정</b>
            </span>
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

      <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
        반영 후 예상재고:{" "}
        <span className="font-semibold">
          {fmt(cassette.currentInventory)} → {fmt(projected)}정
        </span>
      </div>

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
