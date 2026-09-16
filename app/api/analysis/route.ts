import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import { parseUsageFile } from "@/lib/pampro/parseUsageFile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export interface AnalysisItem {
  cassetteId: string | null;
  machineName: string;
  cassetteNumber: number;
  drugName: string;
  dailyAvg30: number;       // 최근 30일 일평균 (전체 일수 기준)
  dailyAvg30Wd: number;     // 최근 30일 일평균 (평일 일수 기준)
  daysInWindow: number;     // 윈도우 내 실제 커버 일수
  weekdaysInWindow: number; // 윈도우 내 평일 수
  currentThreshold: number;
  lowSample: boolean;       // daysInWindow < 14
  // diff를 end-date 요일에 귀속 후 요일별 평균 (excludeWeekends는 바 표시만 제어)
  dayOfWeekUsage: number[]; // [월, 화, 수, 목, 금, 토, 일]
}

export interface AnalysisGetResponse {
  items: AnalysisItem[];
  snapshotCount: number;
}

// ── 공통 계산 로직 ────────────────────────────────────────────────────

type TimelineMap = Map<string, { date: Date; usage: number }[]>;

function computeAnalysisItems(
  timeline: TimelineMap,
  drugNameMap: Map<string, string>,
  cassettes: { id: string; cassetteNumber: number; refillThreshold: number; machine: { name: string } }[]
): AnalysisItem[] {
  const cassetteMap = new Map(cassettes.map((c) => [`${c.machine.name}::${c.cassetteNumber}`, c]));

  // shortKey별 집계: 지배적 타임라인 + 요일별 사용량 직접 값 수집
  const shortKeyMap = new Map<
    string,
    { domPoints: { date: Date; usage: number }[]; domDrugName: string; dowValues: number[][] }
  >();

  for (const [key, points] of timeline) {
    const parts = key.split("::");
    const shortKey = `${parts[0]}::${parts[1]}`;
    const drugName = drugNameMap.get(key) ?? "";

    const dowArrays: number[][] = Array.from({ length: 7 }, () => []);
    for (const point of points) {
      if (point.usage > 0) {
        const rawDay = point.date.getUTCDay(); // 0=Sun
        const monFirst = rawDay === 0 ? 6 : rawDay - 1; // Mon=0..Sun=6
        dowArrays[monFirst].push(point.usage);
      }
    }

    const ex = shortKeyMap.get(shortKey);
    if (!ex) {
      shortKeyMap.set(shortKey, { domPoints: points, domDrugName: drugName, dowValues: dowArrays });
    } else {
      for (let d = 0; d < 7; d++) ex.dowValues[d].push(...dowArrays[d]);
      if (points.length > ex.domPoints.length) {
        ex.domPoints = points;
        ex.domDrugName = drugName;
      }
    }
  }

  const results: AnalysisItem[] = [];

  for (const [shortKey, { domPoints, domDrugName, dowValues }] of shortKeyMap) {
    const hasData = domPoints.some((p) => p.usage > 0);
    if (!hasData) continue;

    const [machineName, cassetteNumberStr] = shortKey.split("::");
    const cassetteNumber = Number(cassetteNumberStr);

    // 최근 30일 윈도우 — 날짜 기준 필터
    const endDate = domPoints[domPoints.length - 1].date;
    const cutoff = new Date(endDate.getTime() - 30 * 86400000);
    const windowPoints = domPoints.filter((p) => p.date >= cutoff && p.usage > 0);

    const daysInWindow = windowPoints.length;
    const totalUsage = windowPoints.reduce((s, p) => s + p.usage, 0);
    const dailyAvg30 =
      daysInWindow > 0 ? Math.round((totalUsage / daysInWindow) * 10) / 10 : 0;
    const lowSample = daysInWindow < 3;

    // 평일 파일만 — 주말 제외 평균
    const weekdayPoints = windowPoints.filter((p) => {
      const d = p.date.getUTCDay();
      return d !== 0 && d !== 6;
    });
    const weekdaysInWindow = weekdayPoints.length;
    const weekdayUsage = weekdayPoints.reduce((s, p) => s + p.usage, 0);
    const dailyAvg30Wd =
      weekdaysInWindow > 0
        ? Math.round((weekdayUsage / weekdaysInWindow) * 10) / 10
        : dailyAvg30;

    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : Math.round((arr.reduce((s: number, v: number) => s + v, 0) / arr.length) * 10) / 10;

    const dayOfWeekUsage = dowValues.map(avg);

    const cassette = cassetteMap.get(shortKey) ?? null;

    results.push({
      cassetteId: cassette?.id ?? null,
      machineName,
      cassetteNumber,
      drugName: domDrugName,
      dailyAvg30,
      dailyAvg30Wd,
      daysInWindow: Math.round(daysInWindow),
      weekdaysInWindow,
      currentThreshold: cassette?.refillThreshold ?? 0,
      lowSample,
      dayOfWeekUsage,
    });
  }

  results.sort((a, b) => {
    if ((a.cassetteId === null) !== (b.cassetteId === null))
      return a.cassetteId === null ? 1 : -1;
    if (a.machineName !== b.machineName) return a.machineName.localeCompare(b.machineName);
    return a.cassetteNumber - b.cassetteNumber;
  });

  return results;
}

// ── GET: 저장된 스냅샷으로 자동 분석 ────────────────────────────────

export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();

    const snapshots = await prisma.usageSnapshot.findMany({
      where: { hospitalId, status: "APPLIED" },
      select: {
        queryPeriodEnd: true,
        appliedAt: true,
        lines: {
          where: { matchStatus: "MATCHED", cassetteNumber: { not: null } },
          select: {
            machineName: true,
            cassetteNumber: true,
            drugCode: true,
            drugName: true,
            cumulativeUsage: true,
          },
        },
      },
      orderBy: { queryPeriodEnd: "asc" },
    });

    const snapshotCount = snapshots.length;

    if (snapshotCount < 2) {
      return ok({ items: [], snapshotCount } satisfies AnalysisGetResponse);
    }

    const timeline: TimelineMap = new Map();
    const drugNameMap = new Map<string, string>();

    for (const snap of snapshots) {
      const date = snap.queryPeriodEnd ?? snap.appliedAt;
      if (!date) continue;

      for (const line of snap.lines) {
        if (line.cassetteNumber == null) continue;
        const key = `${line.machineName}::${line.cassetteNumber}::${line.drugCode ?? ""}`;
        const arr = timeline.get(key) ?? [];
        const existing = arr.find((x) => x.date.getTime() === date.getTime());
        if (existing) {
          existing.usage = Math.max(existing.usage, line.cumulativeUsage);
        } else {
          arr.push({ date, usage: line.cumulativeUsage });
        }
        timeline.set(key, arr);
        drugNameMap.set(key, line.drugName);
      }
    }

    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      select: { id: true, cassetteNumber: true, refillThreshold: true, machine: { select: { name: true } } },
    });

    const items = computeAnalysisItems(timeline, drugNameMap, cassettes);
    return ok({ items, snapshotCount } satisfies AnalysisGetResponse);
  });
}

// ── POST: 업로드 파일로 분석 ─────────────────────────────────────────

export async function POST(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const form = await req.formData();

    const entries: { buffer: Buffer; date: Date }[] = [];
    let i = 0;
    while (form.has(`file_${i}`)) {
      const file = form.get(`file_${i}`);
      const dateStr = form.get(`date_${i}`);
      if (file instanceof File && typeof dateStr === "string" && dateStr) {
        const buffer = Buffer.from(await file.arrayBuffer());
        entries.push({ buffer, date: new Date(dateStr + "T00:00:00Z") });
      }
      i++;
    }
    if (entries.length < 1) return fail("파일이 없습니다.");

    const parsed = entries
      .map((e) => {
        try {
          return { date: e.date, result: parseUsageFile(e.buffer) };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { date: Date; result: ReturnType<typeof parseUsageFile> }[];

    parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

    const timeline: TimelineMap = new Map();
    const drugNameMap = new Map<string, string>();

    for (const p of parsed) {
      for (const agg of p.result.aggregated) {
        const key = `${agg.machineName}::${agg.cassetteNumber}::${agg.drugCode ?? ""}`;
        const arr = timeline.get(key) ?? [];
        const existing = arr.find((x) => x.date.getTime() === p.date.getTime());
        if (existing) {
          existing.usage = Math.max(existing.usage, agg.cumulativeUsage);
        } else {
          arr.push({ date: p.date, usage: agg.cumulativeUsage });
        }
        timeline.set(key, arr);
        drugNameMap.set(key, agg.drugName);
      }
    }

    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      select: { id: true, cassetteNumber: true, refillThreshold: true, machine: { select: { name: true } } },
    });

    const items = computeAnalysisItems(timeline, drugNameMap, cassettes);
    if (items.length === 0) return fail("유효한 일별 사용량 차이를 계산할 수 없습니다.");

    return ok(items);
  });
}
