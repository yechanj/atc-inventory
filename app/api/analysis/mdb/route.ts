import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { computeAnalysisItems, type TimelineMap } from "@/lib/services/analysisService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) return fail("startDate, endDate가 필요합니다.");
    if (startDate > endDate) return fail("시작일이 종료일보다 늦을 수 없습니다.");

    const logs = await prisma.mdbUsageLog.findMany({
      where: { hospitalId, fillDate: { gte: startDate, lte: endDate } },
      select: { canister: true, fillDate: true, drugCode: true, drugName: true, qty: true },
    });

    if (logs.length === 0) return fail("해당 기간의 MDB 데이터가 없습니다.", 404);

    // 카세트번호별 · 날짜별 qty 합산
    const dailyMap = new Map<number, Map<string, { qty: number; drugCode: string; drugName: string }>>();
    for (const log of logs) {
      const byDate = dailyMap.get(log.canister) ?? new Map();
      const existing = byDate.get(log.fillDate);
      byDate.set(log.fillDate, {
        qty: (existing?.qty ?? 0) + log.qty,
        drugCode: log.drugCode,
        drugName: log.drugName,
      });
      dailyMap.set(log.canister, byDate);
    }

    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      select: { id: true, cassetteNumber: true, refillThreshold: true, drugCode: true, machine: { select: { name: true } } },
    });
    const cassetteByNumber = new Map(cassettes.map((c) => [c.cassetteNumber, c]));

    const timeline: TimelineMap = new Map();
    const drugNameMap = new Map<string, string>();

    for (const [canister, byDate] of dailyMap) {
      const cassette = cassetteByNumber.get(canister);
      const machineName = cassette?.machine.name ?? "Unknown";

      // 마지막 항목의 drugCode/drugName 사용
      const entries = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
      const { drugCode, drugName } = entries[entries.length - 1][1];

      const key = `${machineName}::${canister}::${drugCode}`;
      const points = entries.map(([dateStr, { qty }]) => ({
        date: new Date(dateStr + "T00:00:00Z"),
        usage: qty,
      }));

      timeline.set(key, points);
      drugNameMap.set(key, drugName);
    }

    const items = computeAnalysisItems(timeline, drugNameMap, cassettes);
    return ok(items);
  });
}
