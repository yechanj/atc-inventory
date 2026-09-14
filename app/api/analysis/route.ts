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
  n: number;
  mean: number;
  p90: number;
  threshold: number;
  currentThreshold: number;
  lowSample: boolean; // n < 10 → 직접 확인 권장
}

function computeP90(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(0.90 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function POST(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const form = await req.formData();

    // 1. 파일 + 날짜 수집
    const entries: { buffer: Buffer; date: Date; filename: string }[] = [];
    let i = 0;
    while (form.has(`file_${i}`)) {
      const file = form.get(`file_${i}`);
      const dateStr = form.get(`date_${i}`);
      if (file instanceof File && typeof dateStr === "string" && dateStr) {
        const buffer = Buffer.from(await file.arrayBuffer());
        entries.push({ buffer, date: new Date(dateStr + "T00:00:00Z"), filename: file.name });
      }
      i++;
    }
    if (entries.length < 2) return fail("최소 2개 이상의 날짜 파일이 필요합니다.");

    // 2. 파싱 후 날짜순 정렬
    const parsed = entries.map((e) => {
      try {
        return { date: e.date, result: parseUsageFile(e.buffer) };
      } catch {
        return null;
      }
    }).filter(Boolean) as { date: Date; result: ReturnType<typeof parseUsageFile> }[];

    parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 3. key별 누적값 타임라인 구성 (key = "machineName::cassetteNumber::drugCode")
    const timeline = new Map<string, { date: Date; usage: number }[]>();
    const drugNameMap = new Map<string, string>();

    for (const p of parsed) {
      for (const agg of p.result.aggregated) {
        const key = `${agg.machineName}::${agg.cassetteNumber}::${agg.drugCode ?? ""}`;
        const arr = timeline.get(key) ?? [];
        // 같은 날짜 중복이면 가장 큰 값 유지
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

    // 4. 연속 diff 계산 (diff > 0만 수집)
    const diffsMap = new Map<string, number[]>();
    for (const [key, points] of timeline) {
      const diffs: number[] = [];
      for (let j = 1; j < points.length; j++) {
        const diff = points[j].usage - points[j - 1].usage;
        if (diff > 0) diffs.push(diff);
      }
      if (diffs.length > 0) diffsMap.set(key, diffs);
    }

    if (diffsMap.size === 0) return fail("유효한 일별 사용량 차이를 계산할 수 없습니다.");

    // 5. drugCode 다른 동일 카세트 병합 → shortKey = "machineName::cassetteNumber"
    const merged = new Map<string, { diffs: number[]; drugName: string }>();
    for (const [key, diffs] of diffsMap) {
      const parts = key.split("::");
      const shortKey = `${parts[0]}::${parts[1]}`;
      const existing = merged.get(shortKey);
      if (existing) {
        const prevLen = existing.diffs.length;
        existing.diffs.push(...diffs);
        if (diffs.length > prevLen) existing.drugName = drugNameMap.get(key) ?? existing.drugName;
      } else {
        merged.set(shortKey, { diffs: [...diffs], drugName: drugNameMap.get(key) ?? "" });
      }
    }

    // 6. DB에서 카세트 전체 조회 (단일 쿼리)
    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      select: { id: true, cassetteNumber: true, refillThreshold: true, machine: { select: { name: true } } },
    });
    const cassetteMap = new Map(cassettes.map((c) => [`${c.machine.name}::${c.cassetteNumber}`, c]));

    // 7. 통계 계산 + 응답 구성
    const results: AnalysisItem[] = [];

    for (const [shortKey, { diffs, drugName }] of merged) {
      const [machineName, cassetteNumberStr] = shortKey.split("::");
      const cassetteNumber = Number(cassetteNumberStr);
      const n = diffs.length;
      const mean = diffs.reduce((s, v) => s + v, 0) / n;
      const sorted = [...diffs].sort((a, b) => a - b);
      const p90 = computeP90(sorted);
      const threshold = Math.round(p90 / 10) * 10 || 10;
      const lowSample = n < 10;

      const cassette = cassetteMap.get(shortKey) ?? null;

      results.push({
        cassetteId: cassette?.id ?? null,
        machineName,
        cassetteNumber,
        drugName,
        n,
        mean: Math.round(mean * 10) / 10,
        p90: Math.round(p90 * 10) / 10,
        threshold,
        currentThreshold: cassette?.refillThreshold ?? 0,
        lowSample,
      });
    }

    results.sort((a, b) => {
      if ((a.cassetteId === null) !== (b.cassetteId === null))
        return a.cassetteId === null ? 1 : -1;
      if (a.machineName !== b.machineName) return a.machineName.localeCompare(b.machineName);
      return a.cassetteNumber - b.cassetteNumber;
    });

    return ok(results);
  });
}
