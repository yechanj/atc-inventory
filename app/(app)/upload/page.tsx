import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { getSnapshotPreview } from "@/lib/services/snapshotService";
import { UploadClient } from "./UploadClient";
import type { Preview, UploadLogEntry } from "@/lib/types";

export default async function UploadPage() {
  const hospitalId = await getCurrentHospitalId();

  const [pendingSnap, appliedSnaps] = await Promise.all([
    prisma.usageSnapshot.findFirst({
      where: { hospitalId, status: "PENDING" },
      orderBy: { uploadedAt: "desc" },
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

  const pending = pendingSnap ? await getSnapshotPreview(pendingSnap.id) : null;

  return (
    <UploadClient
      initialPending={pending as unknown as Preview | null}
      initialRecentApplied={appliedSnaps as unknown as UploadLogEntry[]}
    />
  );
}
