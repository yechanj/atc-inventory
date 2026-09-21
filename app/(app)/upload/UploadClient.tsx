"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, fmt, fmtDateTime } from "@/lib/client";
import { useToast } from "@/components/Toast";
import { ConfirmModal } from "@/components/Modal";
import type { Preview, PreviewLine, UploadLogEntry } from "@/lib/types";

interface MdbState {
  agentKey: string | null;
  lastIndex: number;
  lastSyncedAt: string | null;
}

export function UploadClient({
  initialPending,
  initialRecentApplied,
  initialMdbState,
}: {
  initialPending: Preview | null;
  initialRecentApplied: UploadLogEntry[];
  initialMdbState: MdbState | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // 탭 재진입 시 최신 데이터 반영
  useEffect(() => {
    apiFetch<{ pending: Preview | null; recentApplied: UploadLogEntry[] }>("/api/upload")
      .then(({ pending, recentApplied }) => {
        setPreview(pending);
        setRecentApplied(recentApplied);
        if (pending) {
          setTab(pending.applicableCount > 0 ? "apply" : pending.decreaseCount > 0 ? "decrease" : "apply");
        }
      })
      .catch(() => {});
  }, []);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [queryDate, setQueryDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recentApplied, setRecentApplied] = useState<UploadLogEntry[]>(initialRecentApplied);
  const [preview, setPreview] = useState<Preview | null>(initialPending);
  const [dragOver, setDragOver] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<UploadLogEntry | null>(null);
  const [rolling, setRolling] = useState(false);
  const [tab, setTab] = useState<"apply" | "decrease" | "unmatched" | "nocassette">(() => {
    if (!initialPending) return "apply";
    return initialPending.applicableCount > 0 ? "apply" : initialPending.decreaseCount > 0 ? "decrease" : "apply";
  });

  function selectFile(file: File) {
    setQueryDate(new Date().toISOString().split("T")[0]);
    setPendingFile(file);
    setDateModalOpen(true);
  }

  function closeDateModal() {
    setDateModalOpen(false);
    setPendingFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const upload = useCallback(
    async (file: File, date: string) => {
      if (uploading) return;
      setUploading(true);
      const form = new FormData();
      form.append("file", file);
      form.append("queryPeriodStart", date);
      form.append("queryPeriodEnd", date);
      try {
        const data = await apiFetch<Preview>("/api/upload", { method: "POST", body: form });
        setPreview(data);
        setDateModalOpen(false);
        setPendingFile(null);
        setTab(data.applicableCount > 0 ? "apply" : data.decreaseCount > 0 ? "decrease" : "apply");
        toast("파일을 읽었습니다. 미리보기를 확인하세요.", "info");
      } catch (e: any) {
        if (e.code === "EXISTING_PENDING") {
          toast("대기 중인 파일이 있습니다. 먼저 반영하거나 취소하세요.", "error");
        } else {
          toast(e.message, "error");
        }
        closeDateModal();
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [uploading, toast]
  );

  async function apply() {
    if (!preview || applying) return;
    setApplying(true);
    try {
      const res = await apiFetch<{ appliedLines: number; totalDeducted: number; clampedCassettes: number }>(
        `/api/snapshots/${preview.snapshotId}/apply`,
        { method: "POST" }
      );
      toast(
        `사용량 반영 완료 — ${res.appliedLines}개 카세트, 총 ${fmt(res.totalDeducted)}정 차감` +
          (res.clampedCassettes > 0 ? ` (재고부족 ${res.clampedCassettes}건 확인필요)` : ""),
        "success"
      );
      setRecentApplied((prev) => [
        {
          id: preview.snapshotId,
          originalFilename: preview.originalFilename,
          appliedAt: new Date().toISOString(),
          queryPeriodStart: preview.queryPeriodStart ?? null,
          uploadedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setConfirmApply(false);
      setPreview(null);
      router.refresh();
      router.push("/today");
    } catch (e) {
      toast((e as Error).message, "error");
      setConfirmApply(false);
    } finally {
      setApplying(false);
    }
  }

  async function cancel() {
    if (!preview) return;
    try {
      await apiFetch(`/api/snapshots/${preview.snapshotId}/cancel`, { method: "POST" });
      toast("업로드를 취소했습니다.", "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPreview(null);
    }
  }

  async function resetAll() {
    if (resetting) return;
    setResetting(true);
    try {
      const res = await apiFetch<{ machinesDeleted: number; cassettesDeleted: number }>(
        "/api/reset",
        { method: "POST" }
      );
      setPreview(null);
      setRecentApplied([]);
      setConfirmReset(false);
      toast(`초기화 완료 — 카세트 ${res.cassettesDeleted}개, 장비 ${res.machinesDeleted}개 삭제됨.`, "info");
    } catch (e) {
      toast((e as Error).message, "error");
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }

  async function rollback() {
    if (!rollbackTarget || rolling) return;
    setRolling(true);
    try {
      const res = await apiFetch<{ reversedLines: number; totalRestored: number; hasSubsequentOps: boolean }>(
        `/api/snapshots/${rollbackTarget.id}/rollback`,
        { method: "POST" }
      );
      setRecentApplied((prev) => prev.filter((e) => e.id !== rollbackTarget.id));
      setRollbackTarget(null);
      toast(
        `되돌리기 완료 — ${res.reversedLines}개 카세트, ${fmt(res.totalRestored)}정 복원`,
        "success"
      );
      if (res.hasSubsequentOps) {
        toast("이후에 다른 작업이 있었으므로 변동 기록 맥락이 달라질 수 있습니다.", "info");
      }
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
      setRollbackTarget(null);
    } finally {
      setRolling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">사용량 업로드</h1>
      </div>

      {preview ? (
        <PreviewView
          preview={preview}
          tab={tab}
          setTab={setTab}
          onApply={() => setConfirmApply(true)}
          onCancel={cancel}
        />
      ) : (
        <div className="space-y-4">
          <MdbSettingsCard initialState={initialMdbState} />

          <div
            className={
              "card flex items-center gap-6 px-8 py-6 cursor-pointer transition " +
              (dragOver ? "bg-brand-50 ring-2 ring-brand-300" : "hover:bg-slate-50")
            }
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) selectFile(f);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <div className={`shrink-0 rounded-full p-4 transition ${dragOver ? "bg-brand-100" : "bg-slate-100"}`}>
              <svg className={`h-8 w-8 transition ${dragOver ? "text-brand-600" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-slate-700">PamPro 일자별 사용량 파일</p>
              <p className="mt-0.5 text-sm text-slate-400">클릭하거나 파일을 드래그하세요 · 파일 선택 후 조회 날짜를 확인합니다</p>
            </div>
            <button
              className="btn-primary shrink-0"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            >
              파일 선택
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx,.txt"
              className="hidden"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) selectFile(f);
              }}
            />
          </div>

          {recentApplied.length > 0 && (
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3">
                <span className="font-semibold text-slate-700">반영 기록</span>
              </div>
              <UploadLog entries={recentApplied} onRollback={setRollbackTarget} />
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="text-xs text-slate-400 underline hover:text-rose-500 transition"
              onClick={() => setConfirmReset(true)}
            >
              테스트 초기화
            </button>
          </div>
        </div>
      )}

      {dateModalOpen && (
        <DatePickerModal
          filename={pendingFile?.name ?? ""}
          date={queryDate}
          onDateChange={setQueryDate}
          onConfirm={() => pendingFile && upload(pendingFile, queryDate)}
          onClose={closeDateModal}
          loading={uploading}
        />
      )}

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetAll}
        title="테스트 초기화"
        danger
        loading={resetting}
        confirmLabel="전체 초기화"
        confirmText="초기화"
        message={
          <div>
            <p><b>모든 카세트·장비·사용량 기록</b>이 삭제됩니다.</p>
            <p className="mt-1 text-slate-500">초기화 후 파일을 업로드하면 카세트가 자동으로 생성됩니다.</p>
          </div>
        }
      />

      <ConfirmModal
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onConfirm={rollback}
        title="사용량 반영 되돌리기"
        danger
        loading={rolling}
        confirmLabel="되돌리기"
        confirmText="되돌리기"
        message={
          rollbackTarget && (
            <div className="space-y-2 text-sm">
              <p>
                <b>{rollbackTarget.originalFilename}</b> 반영분을 되돌립니다.
              </p>
              <p className="text-slate-500">
                해당 업로드로 차감된 재고가 전부 복원되고 변동 기록에서 삭제됩니다.
              </p>
              <p className="rounded bg-amber-50 px-3 py-2 text-amber-700 text-xs">
                ⚠ 이후에 보충·재고조사 등이 있었다면 변동 기록 맥락이 달라질 수 있습니다.
              </p>
            </div>
          )
        }
      />

      <ConfirmModal
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        onConfirm={apply}
        title="사용량 반영"
        loading={applying}
        confirmLabel="반영하기"
        message={
          preview && (
            <>
              {preview.isBaseline && (
                <div className="mb-2 rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-700">
                  이 날짜의 첫 등록 — 전체 사용량을 차감합니다.
                </div>
              )}
              <b>{preview.applicableCount}</b>개 카세트에서 총{" "}
              <b>{fmt(preview.totalNewUsage)}정</b>을 차감합니다.
              {preview.decreaseCount > 0 && (
                <div className="mt-2 text-amber-700">
                  ⚠ 사용량 감소 {preview.decreaseCount}건은 자동 반영에서 제외됩니다.
                </div>
              )}
              <div className="mt-2 text-xs text-slate-400">이 작업은 재고를 즉시 변경합니다.</div>
            </>
          )
        }
      />
    </div>
  );
}

function DateBadge({ dateStr, active }: { dateStr: string | null | undefined; active?: boolean }) {
  if (!dateStr) return <div className="w-14 shrink-0" />;
  const [, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  return (
    <div className={`w-14 shrink-0 rounded-lg py-1 text-center ${active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"}`}>
      <div className="text-[10px] font-medium leading-none">{month}월</div>
      <div className="text-xl font-bold leading-tight tabular-nums">{day}</div>
    </div>
  );
}

function UploadLog({ entries, onRollback }: { entries: UploadLogEntry[]; onRollback: (e: UploadLogEntry) => void }) {
  const maxDate = entries.reduce((max, e) => {
    const d = e.queryPeriodStart ?? "";
    return d > max ? d : max;
  }, "");

  return (
    <div className="divide-y divide-slate-50 overflow-auto max-h-[calc(100vh-280px)]">
      {entries.map((e) => {
        const closed = !!e.queryPeriodStart && e.queryPeriodStart < maxDate;
        return (
          <div key={e.id} className={`flex items-center gap-4 px-5 py-3.5 transition ${closed ? "opacity-50" : ""}`}>
            <DateBadge dateStr={e.queryPeriodStart} active={!closed} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {closed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    마감 완료
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    최근 반영
                  </span>
                )}
                <span className="text-sm text-slate-600 font-medium">{fmtDateTime(e.appliedAt)} 반영</span>
              </div>
              <p className="truncate text-xs text-slate-400">{e.originalFilename}</p>
            </div>
            <button
              title="이 반영 되돌리기"
              onClick={() => onRollback(e)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 transition"
            >
              되돌리기
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DatePickerModal({ filename, date, onDateChange, onConfirm, onClose, loading }: {
  filename: string; date: string; onDateChange: (d: string) => void;
  onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !loading) onConfirm();
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, onConfirm, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="card w-full max-w-xs shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="p-5">
          <p className="font-semibold text-slate-800">조회 날짜 확인</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{filename}</p>
          <div className="mt-4">
            <label className="label block">PamPro 조회 날짜</label>
            <input
              type="date"
              className="input mt-1.5 w-full"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-slate-400">PamPro에서 이 파일을 조회한 날짜를 입력하세요.</p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={loading}>취소</button>
            <button className="btn-primary" onClick={onConfirm} disabled={loading || !date}>
              {loading ? "올리는 중…" : "올리기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewView({ preview, tab, setTab, onApply, onCancel }: {
  preview: Preview; tab: string; setTab: (t: any) => void; onApply: () => void; onCancel: () => void;
}) {
  const applyLines = preview.lines.filter((l) => l.matchStatus === "MATCHED" && !l.decreaseFlag && (l.newUsage ?? 0) > 0);
  const decreaseLines = preview.lines.filter((l) => l.decreaseFlag);
  const unmatchedLines = preview.lines.filter((l) => l.matchStatus === "UNMATCHED");
  const noCassetteLines = preview.lines.filter((l) => l.matchStatus === "NO_CASSETTE");

  const tabs = [
    { key: "apply", label: `반영 대상 (${applyLines.length})` },
    { key: "decrease", label: `사용량 감소 (${decreaseLines.length})`, warn: decreaseLines.length > 0 },
    { key: "unmatched", label: `미매칭 (${unmatchedLines.length})`, warn: unmatchedLines.length > 0 },
    { key: "nocassette", label: `수동조제 (${noCassetteLines.length})` },
  ];

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateBadge dateStr={preview.queryPeriodStart} active />
            <div>
              <div className="font-semibold text-slate-700">
                {preview.queryPeriodStart
                  ? (() => { const [, m, d] = preview.queryPeriodStart.slice(0, 10).split("-").map(Number); return `${m}월 ${d}일 사용량`; })()
                  : preview.originalFilename}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{preview.originalFilename}</div>
            </div>
            {preview.isBaseline ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">첫 등록 — 전체 차감</span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">추가 반영 — 차이만 차감</span>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onCancel}>취소</button>
            <button className="btn-primary" onClick={onApply} disabled={applyLines.length === 0}>
              사용량 반영 ({applyLines.length})
            </button>
          </div>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
            {preview.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
      </div>

      <div className="flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (tab === t.key ? "bg-brand-600 text-white" : (t.warn ? "text-amber-700 " : "text-slate-600 ") + "bg-white ring-1 ring-slate-300 hover:bg-slate-50")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {tab === "apply" && <ApplyTable lines={applyLines} />}
        {tab === "decrease" && <DecreaseTable lines={decreaseLines} />}
        {tab === "unmatched" && <SimpleTable lines={unmatchedLines} emptyMsg="미매칭 약품이 없습니다." />}
        {tab === "nocassette" && <SimpleTable lines={noCassetteLines} emptyMsg="수동조제 약품이 없습니다." />}
      </div>
    </div>
  );
}

function ApplyTable({ lines }: { lines: PreviewLine[] }) {
  if (lines.length === 0) return <Empty msg="반영할 신규 사용량이 없습니다. (첫 반영이거나 사용량 변화 없음)" />;
  return (
    <div className="max-h-[calc(100vh-330px)] overflow-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>카세트</th><th>약품</th>
            <th className="num">이전 사용량</th><th className="num">현재 사용량</th>
            <th className="num">신규 사용량</th><th className="num">반영 후 재고</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="font-medium">#{l.cassetteNumber}</td>
              <td>{l.drugName}</td>
              <td className="num text-slate-500">{fmt(l.previousUsage)}</td>
              <td className="num text-slate-500">{fmt(l.cumulativeUsage)}</td>
              <td className="num font-semibold text-rose-600">-{fmt(l.newUsage)}</td>
              <td className="num">
                {fmt(l.currentInventory)} →{" "}
                <b className={(l.projectedInventory ?? 0) <= 0 ? "text-rose-600" : ""}>{fmt(l.projectedInventory)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecreaseTable({ lines }: { lines: PreviewLine[] }) {
  if (lines.length === 0) return <Empty msg="사용량 감소 항목이 없습니다." />;
  return (
    <div>
      <div className="bg-amber-50 px-4 py-2 text-xs text-amber-800">
        이전 사용량보다 현재 누적 사용량이 작습니다. 조회기간이 변경되었을 가능성이 있어 자동 반영에서 제외됩니다.
      </div>
      <div className="max-h-[calc(100vh-360px)] overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>카세트</th><th>약품</th>
              <th className="num">이전 사용량</th><th className="num">현재 사용량</th><th className="num">차이</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="font-medium">#{l.cassetteNumber}</td>
                <td>{l.drugName}</td>
                <td className="num text-slate-500">{fmt(l.previousUsage)}</td>
                <td className="num text-slate-500">{fmt(l.cumulativeUsage)}</td>
                <td className="num font-semibold text-amber-700">{fmt(l.newUsage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SimpleTable({ lines, emptyMsg }: { lines: PreviewLine[]; emptyMsg: string }) {
  if (lines.length === 0) return <Empty msg={emptyMsg} />;
  return (
    <div className="max-h-[calc(100vh-330px)] overflow-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>카세트</th><th>약품코드</th><th>약품명</th><th className="num">사용량</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="font-medium">{l.cassetteNumber != null ? `#${l.cassetteNumber}` : "-"}</td>
              <td className="text-slate-500">{l.drugCode ?? "-"}</td>
              <td>{l.drugName}</td>
              <td className="num text-slate-500">{fmt(l.cumulativeUsage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-slate-400">{msg}</div>;
}

function MdbSettingsCard({ initialState }: { initialState: MdbState | null }) {
  const { toast } = useToast();
  const [state, setState] = useState<MdbState | null>(initialState);
  const [open, setOpen] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    if (rotating) return;
    if (!confirm("API 키를 재발급하면 현재 실행 중인 exe는 즉시 인증 실패합니다.\nexe에 새 키를 입력해야 다시 작동합니다. 계속하시겠습니까?")) return;
    setRotating(true);
    try {
      const res = await apiFetch<{ agentKey: string }>("/api/mdb-sync", { method: "POST" });
      setState((prev) => prev ? { ...prev, agentKey: res.agentKey } : prev);
      toast("API 키가 재발급되었습니다. exe에 새 키를 입력하세요.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRotating(false);
    }
  }

  async function copyKey() {
    if (!state?.agentKey) return;
    await navigator.clipboard.writeText(state.agentKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const syncing = !!state?.lastSyncedAt;

  return (
    <div className="card overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 transition"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
          <span className="font-semibold text-slate-700 text-sm">ATC 자동차감 설정</span>
          {syncing ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              연동 중
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">미연동</span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {open && state && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          <div>
            <label className="label block text-xs mb-1.5">에이전트 API 키 <span className="text-slate-400 font-normal">(atc_sync.exe 에 입력)</span></label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 break-all select-all">
                {state.agentKey ?? "생성 중..."}
              </code>
              <button
                onClick={copyKey}
                disabled={!state.agentKey}
                className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50 transition min-w-[52px]"
              >
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>

          {(state.lastIndex > 0 || state.lastSyncedAt) && (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500 flex gap-5 flex-wrap">
              <span><span className="text-slate-400">기준 index</span> <b className="text-slate-700">{state.lastIndex.toLocaleString()}</b></span>
              {state.lastSyncedAt && (
                <span><span className="text-slate-400">마지막 동기화</span> <b className="text-slate-700">{fmtDateTime(state.lastSyncedAt)}</b></span>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="text-xs text-slate-400 underline hover:text-rose-500 transition"
              onClick={rotate}
              disabled={rotating}
            >
              {rotating ? "재발급 중…" : "API 키 재발급"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
