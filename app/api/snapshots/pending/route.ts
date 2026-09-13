import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSnapshotPreview } from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();

    const [pendingSnaps, appliedSnaps] = await Promise.all([
      prisma.usageSnapshot.findMany({
        where: { hospitalId, status: "PENDING" },
        orderBy: { uploadedAt: "asc" },
      }),
      prisma.usageSnapshot.findMany({
        where: { hospitalId, status: "APPLIED" },
        orderBy: { appliedAt: "desc" },
        take: 15,
        select: {
          id: true,
          originalFilename: true,
          appliedAt: true,
          queryPeriodStart: true,
          uploadedAt: true,
        },
      }),
    ]);

    const pending = (
      await Promise.all(pendingSnaps.map((s) => getSnapshotPreview(s.id)))
    ).filter(Boolean);

    return ok({ pending, recentApplied: appliedSnaps });
  });
}
