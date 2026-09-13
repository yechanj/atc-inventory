import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { getCassetteStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();

    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      select: {
        currentInventory: true,
        refillThreshold: true,
        targetInventory: true,
        packageSize: true,
        trackingStatus: true,
        needsReview: true,
      },
    });

    const total = cassettes.length;
    const refillNeeded = cassettes.filter((c) => getCassetteStatus(c) === "REFILL").length;
    const reviewNeeded = cassettes.filter((c) => getCassetteStatus(c) === "REVIEW").length;

    const lastApplied = await prisma.usageSnapshot.findFirst({
      where: { hospitalId, status: "APPLIED" },
      orderBy: { appliedAt: "desc" },
      select: { appliedAt: true, originalFilename: true },
    });

    const lastStocktake = await prisma.inventoryHistory.findFirst({
      where: { type: "STOCKTAKE", cassette: { machine: { hospitalId } } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    // 오늘 사용량 반영 여부
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const appliedToday = await prisma.usageSnapshot.count({
      where: { hospitalId, status: "APPLIED", appliedAt: { gte: startOfToday } },
    });

    const pendingCount = await prisma.usageSnapshot.count({
      where: { hospitalId, status: "PENDING" },
    });

    return ok({
      total,
      refillNeeded,
      reviewNeeded,
      appliedToday: appliedToday > 0,
      lastAppliedAt: lastApplied?.appliedAt ?? null,
      lastAppliedFile: lastApplied?.originalFilename ?? null,
      lastStocktakeAt: lastStocktake?.createdAt ?? null,
      pendingCount,
    });
  });
}
