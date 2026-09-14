"use client";

import { useEffect, useState } from "react";
import { Modal, ConfirmModal } from "./Modal";
import { useToast } from "./Toast";
import { apiFetch, fmt } from "@/lib/client";
import type { Cassette } from "@/lib/types";

export function SettingsModal({
  cassette,
  onClose,
  onDone,
}: {
  cassette: Cassette | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(false);
  const [confirmInv, setConfirmInv] = useState(false);

  const key = cassette?.id ?? "";
  useEffect(() => {
    if (cassette) {
      setForm({
        drugCode: cassette.drugCode ?? "",
        drugName: cassette.drugName,
        packageSize: String(cassette.packageSize),
        refillThreshold: String(cassette.refillThreshold),
        recommendedPackages: cassette.recommendedPackages != null ? String(cassette.recommendedPackages) : "",
        fullCapacity: cassette.fullCapacity != null ? String(cassette.fullCapacity) : "",
        currentInventory: String(cassette.currentInventory),
        trackingStatus: cassette.trackingStatus,
      });
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cassette) return null;

  const invChanged = Number(form.currentInventory) !== cassette.currentInventory;

  function set(k: string, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (loading) return;
    setLoading(true);
    try {
      const recPkg = (form.recommendedPackages as string).trim();
      await apiFetch(`/api/cassettes/${cassette!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          drugCode: (form.drugCode as string) || null,
          drugName: form.drugName,
          packageSize: Number(form.packageSize),
          refillThreshold: Number(form.refillThreshold),
          recommendedPackages: recPkg === "" ? null : parseInt(recPkg, 10),
          fullCapacity: (form.fullCapacity as string).trim() === "" ? null : Number(form.fullCapacity),
          trackingStatus: form.trackingStatus,
          currentInventory: Number(form.currentInventory),
        }),
      });
      toast("카세트 설정이 저장되었습니다.", "success");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
      setConfirmInv(false);
    }
  }

  function onSaveClick() {
    // 현재고 직접 수정은 실재고 보정으로 기록됨 → 확인 모달
    if (invChanged) setConfirmInv(true);
    else save();
  }

  return (
    <>
      <Modal open={!!cassette} onClose={onClose} title={`카세트 #${cassette.cassetteNumber} 설정`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="약품코드">
            <input className="input w-full" value={form.drugCode as string}
              onChange={(e) => set("drugCode", e.target.value)} />
          </Field>
          <Field label="약품명">
            <input className="input w-full" value={form.drugName as string}
              onChange={(e) => set("drugName", e.target.value)} />
          </Field>
          <Field label="포장단위">
            <input className="input w-full num" type="number" value={form.packageSize as string}
              onChange={(e) => set("packageSize", e.target.value)} />
          </Field>
          <Field label="추적 여부">
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.trackingStatus as boolean}
                onChange={(e) => set("trackingStatus", e.target.checked)} />
              추적함
            </label>
          </Field>
          <Field label="보충기준">
            <input className="input w-full num" type="number" value={form.refillThreshold as string}
              onChange={(e) => set("refillThreshold", e.target.value)} />
          </Field>
          <Field label="권장 보충량(통)">
            <input className="input w-full num" type="number" min={1}
              placeholder="미설정"
              value={form.recommendedPackages as string}
              onChange={(e) => set("recommendedPackages", e.target.value)} />
          </Field>
          <Field label="만충량(정)">
            <input className="input w-full num" type="number" min={1}
              placeholder="미설정"
              value={form.fullCapacity as string}
              onChange={(e) => set("fullCapacity", e.target.value)} />
          </Field>
          <Field label="현재고 (직접 수정 시 보정 기록됨)">
            <input
              className={"input w-full num " + (invChanged ? "border-amber-400 bg-amber-50" : "")}
              type="number"
              value={form.currentInventory as string}
              onChange={(e) => set("currentInventory", e.target.value)}
            />
          </Field>
        </div>

        {invChanged && (
          <p className="mt-3 text-xs text-amber-700">
            현재고를 {fmt(cassette.currentInventory)} → {fmt(Number(form.currentInventory))}(으)로
            변경합니다. 실재고 보정으로 기록됩니다.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            취소
          </button>
          <button className="btn-primary" onClick={onSaveClick} disabled={loading}>
            {loading ? "저장 중…" : "저장"}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmInv}
        onClose={() => setConfirmInv(false)}
        onConfirm={save}
        title="현재고 직접 변경"
        danger
        loading={loading}
        confirmLabel="변경 및 저장"
        message={
          <>
            현재고를 <b>{fmt(cassette.currentInventory)}</b> →{" "}
            <b>{fmt(Number(form.currentInventory))}</b> (으)로 직접 변경합니다.
            <br />
            이 변경은 <b>실재고 보정</b> 이력으로 남습니다. 계속하시겠습니까?
          </>
        }
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
