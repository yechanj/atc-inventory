"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch, fmt } from "@/lib/client";
import { useToast } from "@/components/Toast";
import type { AnalysisItem } from "@/app/api/analysis/route";

interface FileEntry {
  file: File;
  date: string;
}

function detectDateFromFilename(name: string): string {
  const year = new Date().getFullYear();
  const m = name.match(/^(\d{2})(\d{2})\./);
  if (m) return `${year}-${m[1]}-${m[2]}`;
  return new Date().toISOString().split("T")[0];
}

export default function AnalysisPage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<"upload" | "results">("upload");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisItem[]>([]);
  const [showCappedOnly, setShowCappedOnly] = useState(false);
  const [applying, setApplying] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    setFileEntries((prev) => {
      const newEntries = files
        .filter((f) => /\.(xls|xlsx)$/i.test(f.name) && !prev.some((e) => e.file.name === f.name))
        .map((f) => ({ file: f, date: detectDateFromFilename(f.name) }));
      return [...prev, ...newEntries];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const runAnalysis = useCallback(async () => {
    if (analyzing || fileEntries.length < 2) return;
    setAnalyzing(true);
    try {
      const form = new FormData();
      fileEntries.forEach((entry, i) => {
        form.append(`file_${i}`, entry.file);
        form.append(`date_${i}`, entry.date);
      });
      const data = await apiFetch<AnalysisItem[]>("/api/analysis", { method: "POST", body: form });
      setResults(data);
      setPhase("results");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, fileEntries, toast]);

  const applyThresholds = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      const items = results
        .filter((r) => r.cassetteId !== null)
        .map((r) => ({ cassetteId: r.cassetteId!, threshold: r.threshold }));
      const res = await apiFetch<{ updated: number }>("/api/analysis/apply", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      toast(`기준재고 ${res.updated}개 업데이트 완료`, "success");
      setPhase("upload");
      setFileEntries([]);
      setResults([]);
      setShowCappedOnly(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplying(false);
    }
  }, [applying, results, toast]);

  const matched = results.filter((r) => r.cassetteId !== null);
  const cappedCount = results.filter((r) => r.capped).length;
  const displayed = showCappedOnly ? results.filter((r) => r.capped) : results;

  // ── Upload phase ──────────────────────────────────────────────────
  if (phase === "upload") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">사용량 분석</h1>
          <p className="text-sm text-slate-500">날짜별 XLS 파일을 업로드하면 기준재고를 자동 계산합니다.</p>
        </div>

        {/* Drop zone */}
        <div
          className={
            "card cursor-pointer border-2 border-dashed px-8 py-14 text-center transition " +
            (dragOver
              ? "border-brand-400 bg-brand-50"
              : "border-slate-300 hover:border-slate-400 hover:bg-slate-50")
          }
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <svg
            className="mx-auto h-10 w-10 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 3.75 3.75 0 0 1 4.133 4.303A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">
            XLS 파일을 끌어놓거나 클릭해서 선택하세요
          </p>
          <p className="mt-1 text-xs text-slate-400">여러 파일 동시 선택 가능 · 최소 2개 이상</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx"
            multiple
            className="hidden"
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        {/* File list */}
        {fileEntries.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-medium text-slate-700">
                선택된 파일 <span className="text-brand-600">{fileEntries.length}개</span>
              </span>
              <button
                className="text-xs text-slate-400 hover:text-rose-500 transition"
                onClick={() => setFileEntries([])}
              >
                전체 삭제
              </button>
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-auto">
              {fileEntries.map((entry, i) => (
                <div key={entry.file.name} className="flex items-center gap-3 px-4 py-2.5">
                  <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <span className="max-w-[200px] truncate rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                    {entry.file.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">날짜</span>
                  <input
                    type="date"
                    className="input text-sm"
                    value={entry.date}
                    onChange={(e) =>
                      setFileEntries((prev) =>
                        prev.map((fe, j) => (j === i ? { ...fe, date: e.target.value } : fe))
                      )
                    }
                  />
                  <button
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 transition"
                    onClick={() => setFileEntries((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {fileEntries.length < 2 ? "최소 2개 파일이 필요합니다." : `${fileEntries.length}개 파일 준비 완료`}
          </p>
          <button
            className="btn-primary"
            disabled={fileEntries.length < 2 || analyzing}
            onClick={runAnalysis}
          >
            {analyzing ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4Z" />
                </svg>
                분석 중…
              </span>
            ) : (
              `분석 시작 (${fileEntries.length}개 파일)`
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Results phase ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-xs" onClick={() => setPhase("upload")}>
            ← 다시 선택
          </button>
          <h1 className="text-xl font-bold tracking-tight">
            분석 결과{" "}
            <span className="text-base font-normal text-slate-400">({results.length}개 카세트)</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {cappedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                className="rounded"
                checked={showCappedOnly}
                onChange={(e) => setShowCappedOnly(e.target.checked)}
              />
              <span className="flex items-center gap-1">
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                  ⚠ {cappedCount}
                </span>
                캡 항목만 보기
              </span>
            </label>
          )}
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="card overflow-hidden">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>카세트</th>
                <th>약품명</th>
                <th className="num">n</th>
                <th className="num">일평균</th>
                <th className="num">P95</th>
                <th className="num">현재 기준재고</th>
                <th className="num">권장 기준재고</th>
                <th className="center">캡</th>
                <th className="center">매칭</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((item, idx) => (
                <tr
                  key={idx}
                  className={item.capped ? "border-l-2 border-l-amber-400" : ""}
                >
                  <td className="font-medium text-slate-700">
                    {item.machineName} #{item.cassetteNumber}
                  </td>
                  <td>{item.drugName}</td>
                  <td className={`num ${item.n < 5 ? "text-slate-400" : "text-slate-500"}`}>
                    {item.n}
                    {item.n < 5 && <span className="ml-1 text-xs">⚠</span>}
                  </td>
                  <td className="num text-slate-500">{fmt(item.mean)}</td>
                  <td className="num text-slate-500">{fmt(item.p95)}</td>
                  <td className="num text-slate-500">{fmt(item.currentThreshold)}</td>
                  <td className="num font-semibold text-brand-700">{fmt(item.threshold)}</td>
                  <td className="center text-center">
                    {item.capped && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        ⚠ 캡
                      </span>
                    )}
                  </td>
                  <td className="center text-center">
                    {item.cassetteId ? (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
                        title="매칭됨"
                      />
                    ) : (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300"
                        title="미매칭"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 적용 바 */}
      <div className="card flex items-center justify-between px-5 py-4">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{matched.length}개</span> 카세트에 적용 가능
          {results.length - matched.length > 0 && (
            <span className="ml-2 text-slate-400">
              ({results.length - matched.length}개 미매칭 — 건너뜀)
            </span>
          )}
          {cappedCount > 0 && (
            <span className="ml-3 text-amber-600">
              ⚠ {cappedCount}개 캡 적용 — 직접 확인 권장
            </span>
          )}
        </div>
        <button
          className="btn-primary"
          disabled={matched.length === 0 || applying}
          onClick={applyThresholds}
        >
          {applying ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4Z" />
              </svg>
              적용 중…
            </span>
          ) : (
            `기준재고 일괄 적용 (${matched.length}개)`
          )}
        </button>
      </div>
    </div>
  );
}
