import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import { parseUsageFile } from "@/lib/pampro/parseUsageFile";
import { prisma } from "@/lib/prisma";
import {
  computeAnalysisItems,
  type AnalysisItem,
  type AnalysisGetResponse,
  type TimelineMap,
} from "@/lib/services/analysisService";

export type { AnalysisItem, AnalysisGetResponse };

export const dynamic = "force-dynamic";

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
      select: { id: true, cassetteNumber: true, refillThreshold: true, drugCode: true, machine: { select: { name: true } } },
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
      select: { id: true, cassetteNumber: true, refillThreshold: true, drugCode: true, machine: { select: { name: true } } },
    });

    const items = computeAnalysisItems(timeline, drugNameMap, cassettes);
    if (items.length === 0) return fail("유효한 일별 사용량 차이를 계산할 수 없습니다.");

    return ok(items);
  });
}
