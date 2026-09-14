"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, fmt } from "@/lib/client";
import { getRecommendation, getCassetteStatus, STATUS_BADGE, STATUS_LABEL } from "@/lib/status";
import { RefillModal } from "@/components/RefillModal";
import type { Cassette } from "@/lib/types";

export default function TodayPage() {
  const [rows, setRows] = useState<Cassette[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refillTarget, setRefillTarget] = useState<Cassette | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<Cassette[]>("/api/cassettes?status=REFILL&sort=cassette");
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">
          보충 필요{" "}
          {rows && <span className="text-brand-700">{rows.length}개</span>}
        </h1>
        <Link href="/upload" className="btn-secondary">
          사용량 업로드
        </Link>
      </div>

      <div className="card overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-rose-600">불러오기 실패: {error}</div>
        ) : rows === null ? (
          <div className="p-8 text-center text-slate-400">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-2xl">✅</div>
            <div className="mt-2 text-slate-500">보충이 필요한 카세트가 없습니다.</div>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-180px)] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>카세트</th>
                  <th>약품</th>
                  <th className="num">현재고</th>
                  <th className="num">권장</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const rec = getRecommendation(c);
                  const status = getCassetteStatus(c);
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">
                        {c.machine.name} #{c.cassetteNumber}
                      </td>
                      <td>
                        {c.drugName}
                        {c.drugCode && (
                          <span className="ml-1 text-xs text-slate-400">{c.drugCode}</span>
                        )}
                        {status === "REVIEW" && (
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE.REVIEW}`}>
                            {STATUS_LABEL.REVIEW}
                          </span>
                        )}
                      </td>
                      <td className="num font-semibold text-amber-700">{fmt(c.currentInventory)}</td>
                      <td className="num font-medium">{rec.text}</td>
                      <td>
                        <button className="btn-primary btn-xs" onClick={() => setRefillTarget(c)}>
                          보충
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RefillModal cassette={refillTarget} onClose={() => setRefillTarget(null)} onDone={load} />
    </div>
  );
}
