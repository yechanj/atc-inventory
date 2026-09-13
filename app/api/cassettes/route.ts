import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { getCassetteStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const status = searchParams.get("status") ?? "ALL";
    const sort = searchParams.get("sort") ?? "cassette";
    const machineId = searchParams.get("machineId") ?? undefined;

    const where: any = { machine: { hospitalId } };
    if (machineId) where.machineId = machineId;
    if (q) {
      const asNum = Number(q);
      where.OR = [
        { drugName: { contains: q } },
        { drugCode: { contains: q } },
        ...(Number.isFinite(asNum) ? [{ cassetteNumber: asNum }] : []),
      ];
    }

    let cassettes = await prisma.cassette.findMany({
      where,
      include: { machine: { select: { name: true } } },
    });

    // 상태 필터 (계산 상태 기준)
    if (status !== "ALL") {
      cassettes = cassettes.filter((c) => getCassetteStatus(c) === status);
    }

    // 정렬
    cassettes.sort((a, b) => {
      switch (sort) {
        case "inventory":
          return a.currentInventory - b.currentInventory;
        case "shortage": {
          // 부족순: (현재고 - 보충기준)이 작을수록 위로
          const sa = a.currentInventory - a.refillThreshold;
          const sb = b.currentInventory - b.refillThreshold;
          return sa - sb;
        }
        case "cassette":
        default:
          if (a.machine.name !== b.machine.name)
            return a.machine.name.localeCompare(b.machine.name);
          return a.cassetteNumber - b.cassetteNumber;
      }
    });

    return ok(cassettes);
  });
}
