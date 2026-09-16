"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, fmt } from "@/lib/client";
import { useToast } from "@/components/Toast";
import type { AnalysisItem, AnalysisGetResponse } from "@/app/api/analysis/route";

interface FileEntry {
  file: File;
  date: string;
}

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const COEFFICIENTS = [0.6, 0.7, 0.8, 0.9, 1.0];

function getAvg(item: AnalysisItem, excludeWeekends: boolean) {
  return excludeWeekends ? item.dailyAvg30Wd : item.dailyAvg30;
}

function computeThreshold(item: AnalysisItem, coeff: number, excludeWeekends: boolean) {
  return Math.max(1, Math.round(getAvg(item, excludeWeekends) * coeff));
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

type Phase = "loading" | "results" | "upload";

export default function AnalysisPage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [results, setResults] = useState<AnalysisItem[]>([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [source, setSource] = useState<"db" | "files">("db");

  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);

  const [selected, setSelected] = useState<AnalysisItem | null>(null);
  const [search, setSearch] = useState("");
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [coefficient, setCoefficient] = useState(0.7);

  // 페이지 진입 시 DB 기반 자동 분석
  const loadFromDb = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await apiFetch<AnalysisGetResponse>("/api/analysis");
      setSnapshotCount(data.snapshotCount);
      if (data.items.length > 0) {
        setResults(data.items);
        setSelected(data.items[0]);
        setSource("db");
        setPhase("results");
      } else {
        setPhase("upload");
      }
    } catch {
      setPhase("upload");
    }
  }, []);

  useEffect(() => { loadFromDb(); }, [loadFromDb]);

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

  const runAnalysis = useCallback(async () => {
    if (analyzing || fileEntries.length < 1) return;
    setAnalyzing(true);
    try {
      const form = new FormData();
      fileEntries.forEach((entry, i) => {
        form.append(`file_${i}`, entry.file);
        form.append(`date_${i}`, entry.date);
      });
      const data = await apiFetch<AnalysisItem[]>("/api/analysis", { method: "POST", body: form });
      setResults(data);
      setSelected(data[0] ?? null);
      setSource("files");
      setSearch("");
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
        .map((r) => ({ cassetteId: r.cassetteId!, threshold: computeThreshold(r, coefficient, excludeWeekends) }));
      const res = await apiFetch<{ updated: number }>("/api/analysis/apply", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      toast(`기준재고 ${res.updated}개 업데이트 완료 (계수 ×${coefficient})`, "success");
      // 적용 후 DB 기반으로 새로고침
      setFileEntries([]);
      setSearch("");
      loadFromDb();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplying(false);
    }
  }, [applying, results, coefficient, loadFromDb, toast]);

  const matched = results.filter((r) => r.cassetteId !== null);
  const lowSampleCount = results.filter((r) => r.lowSample).length;

  const filtered = results.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.drugName.toLowerCase().includes(q) || r.machineName.toLowerCase().includes(q);
  });

  // ── 로딩 ─────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="flex h-64 items-center justify-center">
        <svg className="h-6 w-6 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4Z" />
        </svg>
      </div>
    );
  }

  // ── 파일 업로드 ───────────────────────────────────────────────────
  if (phase === "upload") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {source === "files" && results.length > 0 && (
              <button className="btn-secondary btn-xs" onClick={() => setPhase("results")}>
                ← 분석 결과로
              </button>
            )}
            <h1 className="text-xl font-bold tracking-tight">사용량 분석</h1>
          </div>
          {snapshotCount > 0 && source !== "files" && (
            <button className="btn-secondary btn-xs" onClick={loadFromDb}>
              저장 데이터로 보기
            </button>
          )}
        </div>

        {snapshotCount < 2 && (
          <div className="rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-500">
            {snapshotCount === 0
              ? "등록된 스냅샷이 없습니다. 파일을 업로드하거나 상단 업로드 메뉴에서 PamPro 데이터를 먼저 등록하세요."
              : "스냅샷이 1개뿐입니다. 분석을 위해 최소 2개의 날짜 데이터가 필요합니다."}
          </div>
        )}

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
          <p className="mt-1 text-xs text-slate-400">여러 파일 동시 선택 가능 · 최소 2개 이상</p>
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

        {/* 데이터 출처 뱃지 */}
        {source === "db" ? (
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            저장 데이터 · {snapshotCount}개 스냅샷
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            업로드 파일 기준
          </span>
        )}

        {lowSampleCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            ⚠ {lowSampleCount}개 데이터 부족
          </span>
        )}

        {/* 파일로 재분석 버튼 */}
        <button
          className="btn-secondary btn-xs flex items-center gap-1.5"
          onClick={() => { setFileEntries([]); setPhase("upload"); }}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          파일 업로드
        </button>
        {source === "files" && (
          <button className="btn-secondary btn-xs" onClick={loadFromDb}>
            저장 데이터로 보기
          </button>
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
              const thresh = computeThreshold(item, coefficient, excludeWeekends);
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
                  <p className="text-xs text-slate-400 mt-0.5">
                    {item.machineName} · #{item.cassetteNumber}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs font-semibold tabular-nums ${isSelected ? "text-brand-600" : "text-slate-500"}`}>
                      → {thresh}
                    </span>
                    {item.lowSample && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">⚠</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 오른쪽: 상세 뷰 */}
        <div className="flex-1 card overflow-auto">
          {selected ? (
            <div className="flex flex-col h-full">
              <div className="px-6 py-5 border-b border-slate-100 shrink-0 flex items-start justify-between">
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

              <div className="px-6 py-5 border-b border-slate-100 shrink-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">기준 재고</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium text-slate-400 mb-1">현재 기준재고</p>
                    <p className="text-2xl font-bold tabular-nums text-slate-600">{fmt(selected.currentThreshold)}</p>
                  </div>
                  <div className="rounded-xl bg-brand-50 ring-1 ring-brand-200 px-4 py-3">
                    <p className="text-xs font-medium text-brand-600 mb-1">권장 기준재고</p>
                    <p className="text-2xl font-bold tabular-nums text-brand-700">{fmt(computeThreshold(selected, coefficient, excludeWeekends))}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
                  <span className="text-slate-500">{excludeWeekends ? "평일평균" : "일평균"}</span>
                  <span className="font-semibold tabular-nums text-slate-700">{fmt(getAvg(selected, excludeWeekends))}</span>
                  <span className="text-slate-300">×</span>
                  <span className="text-slate-500">계수</span>
                  <span className="font-semibold text-brand-600">{coefficient}</span>
                  <span className="text-slate-300">=</span>
                  <span className="font-bold tabular-nums text-brand-700">{fmt(computeThreshold(selected, coefficient, excludeWeekends))}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {excludeWeekends ? `평일 ${selected.weekdaysInWindow}건` : `${selected.daysInWindow}건`} 기준
                  </span>
                </div>
                {selected.lowSample && (
                  <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                    </svg>
                    최근 30일 데이터가 3건 미만입니다. 직접 확인을 권장합니다.
                  </p>
                )}
              </div>

              <div className="px-6 py-5 flex-1">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">요일별 평균 사용량</p>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 select-none">
                    <input type="checkbox" className="rounded" checked={excludeWeekends}
                      onChange={(e) => setExcludeWeekends(e.target.checked)} />
                    주말 제외
                  </label>
                </div>
                <DayOfWeekChart data={selected.dayOfWeekUsage} excludeWeekends={excludeWeekends} />
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

      {/* 기준재고 적용 바 */}
      <div className="card flex items-center justify-between px-5 py-4 shrink-0">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{matched.length}개</span> 카세트에 적용 가능
          <span className="ml-2 text-slate-400 text-xs">
            일평균 × <span className="font-semibold text-brand-600">{coefficient}</span> 기준
          </span>
          {results.length - matched.length > 0 && (
            <span className="ml-2 text-slate-400">({results.length - matched.length}개 미매칭 — 건너뜀)</span>
          )}
          {lowSampleCount > 0 && (
            <span className="ml-3 text-amber-600">⚠ {lowSampleCount}개 데이터 부족</span>
          )}
        </div>
        <button className="btn-primary" disabled={matched.length === 0 || applying} onClick={applyThresholds}>
          {applying ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4Z" />
              </svg>
              적용 중…
            </span>
          ) : (
            `기준재고 일괄 적용 (×${coefficient}, ${matched.length}개)`
          )}
        </button>
      </div>
    </div>
  );
}
