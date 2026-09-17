"use client";

import { useEffect, useState } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className={"card w-full shadow-xl " + width}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** 위험 작업 확인 모달 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "확인",
  danger = false,
  loading = false,
  confirmText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  confirmText?: string;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const canConfirm = !confirmText || typed === confirmText;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-slate-600">{message}</div>
      {confirmText && (
        <div className="mt-4">
          <label className="text-xs text-slate-500">
            확인을 위해 <b className="text-slate-700 select-all">{confirmText}</b> 를 입력하세요
          </label>
          <input
            className="input mt-1.5 w-full"
            placeholder={confirmText}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canConfirm && !loading) onConfirm(); }}
            autoFocus
          />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose} disabled={loading}>
          취소
        </button>
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={loading || !canConfirm}
        >
          {loading ? "처리 중…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
