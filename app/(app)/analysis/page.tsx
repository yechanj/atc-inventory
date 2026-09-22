"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, fmt } from "@/lib/client";
import { useToast } from "@/components/Toast";
import type { AnalysisItem } from "@/app/api/analysis/route";

interface FileEntry {
  file: File;
  date: string;
}

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const COEFFICIENTS = [0.6, 0.7, 0.8, 0.9, 1.0];
const MAX_LOAD_DAYS = [14, 30, 60, 90];

function getAvg(item: AnalysisItem, excludeWeekends: boolean) {
  return excludeWeekends ? item.dailyAvg30Wd : item.dailyAvg30;
}

function computeThreshold(item: AnalysisItem, coeff: number, excludeWeekends: boolean) {
  return Math.max(1, Math.round(getAvg(item, excludeWeekends) * coeff));
}

function computeMaxLoad(item: AnalysisItem, days: number, excludeWeekends: boolean) {
  return Math.max(1, Math.round(getAvg(item, excludeWeekends) * days));
}

type VolatilityLevel = "안정" | "보통" | "불규칙";

function computeVolatility(item: AnalysisItem, excludeWeekends: boolean): { level: VolatilityLevel; cv: number } {
  const indices = excludeWeekends ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const values = indices.map((i) => item.dayOfWeekUsage[i]);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return { level: "안정", cv: 0 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  const level: VolatilityLevel = cv < 0.3 ? "안정" : cv < 0.7 ? "보통" : "불규칙";
  return { level, cv };
}

function detectDateFromFilename(name: string): string {
  const year = new Date().getFullYear();
  const m = name.match(/^(\d{2})(\d{2})\./);
  if (m) return `${year}-${m[1]}-${m[2]}`;
  return new Date().toISOString().split("T")[0];
}

function DayOfWeekChart({ data, excludeWeekends }: { data: number[]; excludeWeekends: boolean }) {
  const indices = excludeWeekends ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const values = indices.map((i) => data[i]);
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-2 h-32 w-full">
      {indices.map((i) => {
        const val = data[i];
        const pct = val > 0 ? Math.max((val / max) * 100, 4) : 0;
        const isWeekend = i >= 5;
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-end">
            {val > 0 && (
              <span className="text-[10px] font-medium text-slate-500 leading-none">{fmt(val)}</span>
            )}
            <div
              className={`w-full rounded-t transition-all ${
                val === 0 ? "bg-slate-100" : isWeekend ? "bg-brand-300" : "bg-brand-500"
              }`}
              style={{ height: val === 0 ? "4px" : `${pct}%` }}
            />
            <span className={`text-[11px] font-semibold leading-none ${isWeekend ? "text-brand-400" : "text-slate-500"}`}>
              {DAY_LABELS[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type Phase = "results" | "upload" | "mdb";

export default function AnalysisPage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("upload");
  const [mdbStart, setMdbStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [mdbEnd, setMdbEnd] = useState(new Date().toISOString().split("T")[0]);
  const [results, setResults] = useState<AnalysisItem[]>([]);

  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<AnalysisItem | null>(null);
  const [search, setSearch] = useState("");
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [coefficient, setCoefficient] = useState(0.7);
  const [usedFiles, setUsedFiles] = useState<{ name: string; date: string }[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [maxLoadDays, setMaxLoadDays] = useState(30);
  const [detailTab, setDetailTab] = useState<"usage" | "maxload" | "threshold">("usage");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addDate, setAddDate] = useState("");
  const addFileRef = useRef<HTMLInputElement>(null);

  // 분석 결과 복원 (탭 재진입 시)
  useEffect(() => {
    const saved = localStorage.getItem("analysis-results");
    const savedFiles = localStorage.getItem("analysis-files");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as AnalysisItem[];
      if (parsed.length > 0) {
        setResults(parsed);
        setSelected(parsed[0]);
        setPhase("results");
      }
      if (savedFiles) setUsedFiles(JSON.parse(savedFiles));
    } catch { /* ignore */ }
  }, []);

  // 결과 변경 시 저장
  useEffect(() => {
    if (results.length > 0) localStorage.setItem("analysis-results", JSON.stringify(results));
  }, [results]);

  // 파일 업로드 핸들러
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

  const analyzeEntries = useCallback(async (entries: FileEntry[]) => {
    if (entries.length < 1) return;
    setAnalyzing(true);
    setFilesOpen(false);
    try {
      const form = new FormData();
      entries.forEach((entry, i) => {
        form.append(`file_${i}`, entry.file);
        form.append(`date_${i}`, entry.date);
      });
      const data = await apiFetch<AnalysisItem[]>("/api/analysis", { method: "POST", body: form });
      const files = entries.map((e) => ({ name: e.file.name, date: e.date }));
      setFileEntries(entries);
      setResults(data);
      setUsedFiles(files);
      localStorage.setItem("analysis-files", JSON.stringify(files));
      setSelected((prev) => data.find((d) => d.cassetteId === prev?.cassetteId) ?? data[0] ?? null);
      setSearch("");
      setPhase("results");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAnalyzing(false);
    }
  }, [toast]);

  const runAnalysis = useCallback(async () => {
    if (analyzing || fileEntries.length < 1) return;
    await analyzeEntries(fileEntries);
  }, [analyzing, fileEntries, analyzeEntries]);

  const runMdbAnalysis = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const data = await apiFetch<AnalysisItem[]>(
        `/api/analysis/mdb?startDate=${mdbStart}&endDate=${mdbEnd}`
      );
      setResults(data);
      setUsedFiles([]);
      setSelected(data[0] ?? null);
      setSearch("");
      setPhase("results");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, mdbStart, mdbEnd, toast]);

  const applyThresholds = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      const items = results
        .filter((r) => r.cassetteId !== null)
        .map((r) => ({ cassetteId: r.cassetteId!, threshold: computeThreshold(r, coefficient, excludeWeekends) }));
      const res = await apiFetch<{ updated: number }>("/api/analysis/apply", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      toast(`기준재고 ${res.updated}개 업데이트 완료 (계수 ×${coefficient})`, "success");
      // 적용된 기준재고를 로컬 결과에 반영
      const applied = new Map(items.map((it) => [it.cassetteId, it.threshold]));
      setResults((prev) => prev.map((r) =>
        r.cassetteId && applied.has(r.cassetteId)
          ? { ...r, currentThreshold: applied.get(r.cassetteId)! }
          : r
      ));
      setSelected((prev) =>
        prev?.cassetteId && applied.has(prev.cassetteId)
          ? { ...prev, currentThreshold: applied.get(prev.cassetteId)! }
          : prev
      );
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplying(false);
    }
  }, [applying, results, coefficient, excludeWeekends, toast]);

  const applySingle = useCallback(async (item: AnalysisItem) => {
    if (!item.cassetteId || applyingId !== null || applying) return;
    setApplyingId(item.cassetteId);
    try {
      const threshold = computeThreshold(item, coefficient, excludeWeekends);
      await apiFetch<{ updated: number }>("/api/analysis/apply", {
        method: "POST",
        body: JSON.stringify({ items: [{ cassetteId: item.cassetteId, threshold }] }),
      });
      toast(`${item.drugName} → ${threshold} 적용 완료`, "success");
      setResults((prev) => prev.map((r) =>
        r.cassetteId === item.cassetteId ? { ...r, currentThreshold: threshold } : r
      ));
      setSelected((prev) =>
        prev?.cassetteId === item.cassetteId ? { ...prev, currentThreshold: threshold } : prev
      );
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplyingId(null);
    }
  }, [applyingId, applying, coefficient, excludeWeekends, toast]);

  const matched = results.filter((r) => r.cassetteId !== null);
  const lowSampleCount = results.filter((r) => r.lowSample).length;

  const filtered = results.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.drugName.toLowerCase().includes(q) ||
      r.machineName.toLowerCase().includes(q) ||
      (r.drugCode?.toLowerCase().includes(q) ?? false) ||
      String(r.cassetteNumber).includes(q)
    );
  });

  // ── MDB 날짜 분석 ─────────────────────────────────────────────────
  if (phase === "mdb") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {results.length > 0 && (
            <button className="btn-secondary btn-xs" onClick={() => setPhase("results")}>
              ← 분석 결과로
            </button>
          )}
          <h1 className="text-xl font-bold tracking-tight">사용량 분석</h1>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition"
            onClick={() => setPhase("upload")}>파일 업로드</button>
          <button className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-brand-600 shadow-sm">
            MDB 데이터 분석</button>
        </div>

        <div className="card space-y-5 p-6">
          <p className="text-sm text-slate-600">
            자동 연동된 MDB 데이터를 기반으로 날짜 범위를 지정해 사용량을 분석합니다.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">시작일</label>
              <input type="date" className="input text-sm" value={mdbStart}
                onChange={(e) => setMdbStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">종료일</label>
              <input type="date" className="input text-sm" value={mdbEnd}
                onChange={(e) => setMdbEnd(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={analyzing} onClick={runMdbAnalysis}>
              {analyzing ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4Z" />
                  </svg>
                  분석 중…
                </span>
              ) : "분석하기"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 파일 업로드 ───────────────────────────────────────────────────
  if (phase === "upload") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {results.length > 0 && (
              <button className="btn-secondary btn-xs" onClick={() => setPhase("results")}>
                ← 분석 결과로
              </button>
            )}
            <h1 className="text-xl font-bold tracking-tight">사용량 분석</h1>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-brand-600 shadow-sm">
            파일 업로드</button>
          <button className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition"
            onClick={() => setPhase("mdb")}>MDB 데이터 분석</button>
        </div>

        <div
          className={
            "card cursor-pointer border-2 border-dashed px-8 py-14 text-center transition " +
            (dragOver ? "border-brand-400 bg-brand-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50")
          }
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <svg className="mx-auto h-10 w-10 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 3.75 3.75 0 0 1 4.133 4.303A4.5 4.5 0 0 1 17.25 19.5H6.75Z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">XLS 파일을 끌어놓거나 클릭해서 선택하세요</p>
          <p className="mt-1 text-xs text-slate-400">여러 파일 동시 선택 가능</p>
          <input ref={inputRef} type="file" accept=".xls,.xlsx" multiple className="hidden"
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))} />
        </div>

        {fileEntries.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-medium text-slate-700">
                선택된 파일 <span className="text-brand-600">{fileEntries.length}개</span>
              </span>
              <button className="text-xs text-slate-400 hover:text-rose-500 transition" onClick={() => setFileEntries([])}>
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
                    type="date" className="input text-sm" value={entry.date}
                    onChange={(e) => setFileEntries((prev) => prev.map((fe, j) => (j === i ? { ...fe, date: e.target.value } : fe)))}
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
            {fileEntries.length < 1 ? "파일을 선택하세요." : `${fileEntries.length}개 파일 준비 완료`}
          </p>
          <button className="btn-primary" disabled={fileEntries.length < 1 || analyzing} onClick={runAnalysis}>
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

  // ── 분석 결과 ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4" style={{ height: "calc(100vh - 112px)" }}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight">
          사용량 분석{" "}
          <span className="text-base font-normal text-slate-400">({results.length}개 카세트)</span>
        </h1>

        {lowSampleCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            ⚠ {lowSampleCount}개 데이터 부족
          </span>
        )}

        {/* 재분석 버튼들 */}
        <button
          className="btn-secondary btn-xs flex items-center gap-1.5"
          onClick={() => { setFileEntries([]); setPhase("upload"); }}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          파일 업로드
        </button>
        <button
          className="btn-secondary btn-xs flex items-center gap-1.5"
          onClick={() => setPhase("mdb")}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 11.278 3.75 9m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 13.903 3.75 11.625" />
          </svg>
          MDB로 분석
        </button>

        {/* 사용된 파일 목록 */}
        {usedFiles.length > 0 && (
          <div className="relative">
            <button
              className="btn-secondary btn-xs flex items-center gap-1.5"
              onClick={() => { setFilesOpen((o) => !o); setDeleteConfirm(null); setAddMode(false); }}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              파일 {usedFiles.length}개
            </button>
            {filesOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
                {/* 헤더 */}
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">분석에 사용된 파일</span>
                  <button onClick={() => setFilesOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                </div>

                {/* 파일 목록 */}
                <ul className="max-h-56 overflow-auto divide-y divide-slate-50">
                  {usedFiles.map((f) =>
                    deleteConfirm === f.name ? (
                      /* 삭제 확인 행 */
                      <li key={f.name} className="flex items-center gap-2 bg-rose-50 px-4 py-2.5">
                        <span className="flex-1 truncate text-xs text-rose-700">"{f.name}" 삭제할까요?</span>
                        <button
                          className="shrink-0 rounded bg-rose-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-600 transition"
                          onClick={() => {
                            const nextEntries = fileEntries.filter((e) => e.file.name !== f.name);
                            const nextUsed = usedFiles.filter((u) => u.name !== f.name);
                            setDeleteConfirm(null);
                            setUsedFiles(nextUsed);
                            localStorage.setItem("analysis-files", JSON.stringify(nextUsed));
                            if (nextEntries.length > 0) {
                              analyzeEntries(nextEntries);
                            } else {
                              setFileEntries([]);
                            }
                          }}
                        >
                          삭제
                        </button>
                        <button
                          className="shrink-0 text-xs text-slate-400 hover:text-slate-600 transition"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          취소
                        </button>
                      </li>
                    ) : (
                      /* 일반 행 */
                      <li key={f.name} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="flex-1 truncate text-xs text-slate-700">{f.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">{f.date}</span>
                        <button
                          className="shrink-0 text-xs text-slate-300 hover:text-rose-500 transition"
                          onClick={() => setDeleteConfirm(f.name)}
                        >
                          삭제
                        </button>
                      </li>
                    )
                  )}
                </ul>

                {/* 파일 추가 */}
                {addMode ? (
                    <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                      <input
                        ref={addFileRef}
                        type="file"
                        accept=".xls,.xlsx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setAddFile(f);
                          if (f) setAddDate(detectDateFromFilename(f.name));
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600 transition"
                        onClick={() => addFileRef.current?.click()}
                      >
                        {addFile ? addFile.name : "파일 선택…"}
                      </button>
                      <input
                        type="date"
                        className="input text-xs w-full"
                        value={addDate}
                        onChange={(e) => setAddDate(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-primary btn-xs flex-1"
                          disabled={!addFile || !addDate}
                          onClick={() => {
                            if (!addFile || !addDate) return;
                            const newEntry: FileEntry = { file: addFile, date: addDate };
                            setAddMode(false);
                            setAddFile(null);
                            setAddDate("");
                            analyzeEntries([...fileEntries, newEntry]);
                          }}
                        >
                          추가 후 재분석
                        </button>
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => { setAddMode(false); setAddFile(null); setAddDate(""); }}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-slate-100 px-4 py-2.5">
                      <button
                        className="w-full rounded-lg py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 transition"
                        onClick={() => setAddMode(true)}
                      >
                        + 파일 추가
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {/* 계수 선택 */}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs font-medium text-slate-400">기준재고 계수</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            {COEFFICIENTS.map((c) => (
              <button
                key={c}
                onClick={() => setCoefficient(c)}
                className={`px-3 py-1.5 text-sm font-semibold tabular-nums transition border-r border-slate-200 last:border-r-0 ${
                  coefficient === c ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2-패널 */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 왼쪽: 약품 목록 */}
        <div className="w-60 shrink-0 card flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-100 shrink-0">
            <input
              type="text" className="input text-sm w-full" placeholder="약품 검색…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-auto divide-y divide-slate-50">
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">검색 결과 없음</p>
            )}
            {filtered.map((item, idx) => {
              const isSelected = selected === item;
              return (
                <button
                  key={idx}
                  className={`w-full text-left px-4 py-3 transition ${
                    isSelected ? "bg-brand-50 border-l-2 border-brand-500" : "border-l-2 border-transparent hover:bg-slate-50"
                  }`}
                  onClick={() => setSelected(item)}
                >
                  <p className={`text-sm font-medium leading-snug truncate ${isSelected ? "text-brand-800" : "text-slate-700"}`}>
                    {item.drugName}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <span>{item.machineName} · #{item.cassetteNumber}</span>
                    {item.drugCode && (
                      <span className="text-slate-300">·</span>
                    )}
                    {item.drugCode && (
                      <span className="text-slate-500">{item.drugCode}</span>
                    )}
                    {item.lowSample && (
                      <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">⚠</span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 오른쪽: 상세 뷰 */}
        <div className="flex-1 card overflow-hidden flex flex-col">
          {selected ? (
            <div className="flex flex-col h-full">

              {/* 헤더 */}
              <div className="px-6 pt-5 pb-4 shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 leading-snug">{selected.drugName}</h2>
                    <p className="text-sm text-slate-400 mt-0.5">
                      {selected.machineName} · 카세트 #{selected.cassetteNumber}
                    </p>
                  </div>
                  {selected.cassetteId ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />매칭됨
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />미매칭
                    </span>
                  )}
                </div>

                {/* 탭 바 */}
                <div className="flex gap-1 mt-4 bg-slate-100 rounded-xl p-1">
                  {(["usage", "maxload", "threshold"] as const).map((tab) => {
                    const labels = { usage: "사용량", maxload: "최대 적재", threshold: "기준 재고" };
                    return (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(tab)}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                          detailTab === tab
                            ? "bg-white text-slate-800 shadow-sm"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {labels[tab]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 탭 콘텐츠 */}
              <div className="flex-1 overflow-auto px-6 pb-6">

                {/* ── 사용량 탭 ── */}
                {detailTab === "usage" && (() => {
                  const vol = computeVolatility(selected, excludeWeekends);
                  const volStyle: Record<VolatilityLevel, { bg: string; text: string; dot: string; desc: string }> = {
                    안정:   { bg: "bg-emerald-50 ring-1 ring-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400", desc: "요일별 사용량이 고름" },
                    보통:   { bg: "bg-amber-50 ring-1 ring-amber-100",     text: "text-amber-700",   dot: "bg-amber-400",   desc: "요일 간 다소 차이 있음" },
                    불규칙: { bg: "bg-rose-50 ring-1 ring-rose-100",       text: "text-rose-700",    dot: "bg-rose-400",    desc: "특정 요일에 집중됨" },
                  };
                  const vs = volStyle[vol.level];
                  return (
                    <div className="flex flex-col gap-5">
                      {/* 일평균 + 변동성 */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3.5">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-slate-400">일평균</p>
                            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400 select-none">
                              <input type="checkbox" className="rounded h-3 w-3" checked={excludeWeekends}
                                onChange={(e) => setExcludeWeekends(e.target.checked)} />
                              주말 제외
                            </label>
                          </div>
                          <p className="text-2xl font-bold tabular-nums text-slate-700">
                            {fmt(getAvg(selected, excludeWeekends))}
                            <span className="text-sm font-normal text-slate-400 ml-1">개/일</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {excludeWeekends ? `평일 ${selected.weekdaysInWindow}건` : `${selected.daysInWindow}건`} 기준
                          </p>
                        </div>
                        <div className={`rounded-2xl px-4 py-3.5 ${vs.bg}`}>
                          <p className={`text-xs font-medium mb-1 ${vs.text}`}>요일 변동성</p>
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${vs.dot}`} />
                            <p className={`text-2xl font-bold ${vs.text}`}>{vol.level}</p>
                          </div>
                          <p className={`text-xs mt-1 ${vs.text} opacity-70`}>{vs.desc}</p>
                        </div>
                      </div>

                      {/* 요일 차트 */}
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">요일별 평균</p>
                        <DayOfWeekChart data={selected.dayOfWeekUsage} excludeWeekends={excludeWeekends} />
                      </div>

                      {selected.lowSample && (
                        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                          </svg>
                          최근 30일 데이터가 3건 미만입니다. 직접 확인을 권장합니다.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* ── 최대 적재 탭 ── */}
                {detailTab === "maxload" && (
                  <div className="flex flex-col gap-5">
                    {/* N일 선택 */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">유효기간 기준 기간</p>
                      <div className="grid grid-cols-4 gap-2">
                        {MAX_LOAD_DAYS.map((d) => (
                          <button
                            key={d}
                            onClick={() => setMaxLoadDays(d)}
                            className={`rounded-xl py-3 text-sm font-bold transition-all ${
                              maxLoadDays === d
                                ? "bg-brand-600 text-white shadow-sm shadow-brand-200"
                                : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                            }`}
                          >
                            {d}일
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 결과 카드 */}
                    <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 px-6 py-5 text-white">
                      <p className="text-xs font-medium text-slate-400 mb-3">
                        {maxLoadDays}일 내 소비 기준 — 유효기간 문제 없이 채울 수 있는 최대량
                      </p>
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-black tabular-nums leading-none">
                          {fmt(computeMaxLoad(selected, maxLoadDays, excludeWeekends))}
                        </span>
                        <span className="text-lg font-medium text-slate-300 pb-1">개</span>
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-600 flex items-center gap-2 text-sm text-slate-400">
                        <span className="tabular-nums text-slate-300 font-medium">{fmt(getAvg(selected, excludeWeekends))}</span>
                        <span>×</span>
                        <span>{maxLoadDays}일</span>
                        <span className="text-slate-600">=</span>
                        <span className="font-semibold text-white tabular-nums">{fmt(computeMaxLoad(selected, maxLoadDays, excludeWeekends))}</span>
                        <span className="ml-auto text-xs text-slate-500">
                          ({excludeWeekends ? "평일평균" : "일평균"} 기준)
                        </span>
                      </div>
                    </div>

                    {/* 저사용 경고 */}
                    {selected.dailyAvg30 < 1 && (
                      <div className="rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
                        <div className="flex items-center gap-2 mb-1">
                          <svg className="h-4 w-4 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                          </svg>
                          <p className="text-sm font-semibold text-amber-700">저사용량 품목</p>
                        </div>
                        <p className="text-xs text-amber-600">
                          일평균 {fmt(getAvg(selected, excludeWeekends))}개 수준입니다. 유효기간을 직접 확인하고 적재량을 결정하세요.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── 기준 재고 탭 ── */}
                {detailTab === "threshold" && (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-xs font-medium text-slate-400 mb-2">현재 기준재고</p>
                        <p className="text-3xl font-black tabular-nums text-slate-600">{fmt(selected.currentThreshold)}</p>
                      </div>
                      <div className="rounded-2xl bg-brand-50 ring-1 ring-brand-100 px-4 py-4">
                        <p className="text-xs font-medium text-brand-500 mb-2">권장 기준재고</p>
                        <p className="text-3xl font-black tabular-nums text-brand-700">{fmt(computeThreshold(selected, coefficient, excludeWeekends))}</p>
                      </div>
                    </div>

                    {/* 계산식 */}
                    <div className="rounded-2xl bg-slate-50 px-5 py-4">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">계산 근거</p>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500">{excludeWeekends ? "평일평균" : "일평균"}</span>
                        <span className="font-bold tabular-nums text-slate-700">{fmt(getAvg(selected, excludeWeekends))}</span>
                        <span className="text-slate-300">×</span>
                        <span className="text-slate-500">계수</span>
                        <span className="font-bold text-brand-600">{coefficient}</span>
                        <span className="text-slate-300">=</span>
                        <span className="font-black tabular-nums text-brand-700">{fmt(computeThreshold(selected, coefficient, excludeWeekends))}</span>
                        <span className="ml-auto text-xs text-slate-400">
                          {excludeWeekends ? `평일 ${selected.weekdaysInWindow}건` : `${selected.daysInWindow}건`}
                        </span>
                      </div>
                    </div>

                    {selected.lowSample && (
                      <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                        </svg>
                        최근 30일 데이터가 3건 미만입니다. 직접 확인을 권장합니다.
                      </p>
                    )}

                    {selected.cassetteId && (
                      <button
                        className="w-full rounded-2xl bg-brand-600 py-3.5 text-sm font-bold text-white hover:bg-brand-700 transition disabled:opacity-50"
                        disabled={applyingId === selected.cassetteId || applying}
                        onClick={() => applySingle(selected)}
                      >
                        {applyingId === selected.cassetteId
                          ? "적용 중…"
                          : `이 카세트에 적용 (→ ${fmt(computeThreshold(selected, coefficient, excludeWeekends))}개)`}
                      </button>
                    )}

                    {/* 일괄 적용 */}
                    <div className="mt-2 rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between gap-4">
                      <div className="text-sm text-slate-600 min-w-0">
                        <span className="font-semibold text-slate-800">{matched.length}개</span> 카세트 전체에 일괄 적용
                        <span className="ml-2 text-slate-400 text-xs">
                          일평균 × <span className="font-semibold text-brand-600">{coefficient}</span>
                        </span>
                        {results.length - matched.length > 0 && (
                          <span className="ml-2 text-xs text-slate-400">({results.length - matched.length}개 미매칭 건너뜀)</span>
                        )}
                        {lowSampleCount > 0 && (
                          <span className="ml-2 text-xs text-amber-600">⚠ {lowSampleCount}개 데이터 부족</span>
                        )}
                      </div>
                      <button
                        className="shrink-0 btn-primary"
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
                          `일괄 적용 (${matched.length}개)`
                        )}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <svg className="mx-auto h-10 w-10 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5" />
                </svg>
                <p className="mt-3 text-sm text-slate-400">← 약품을 선택하세요</p>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
