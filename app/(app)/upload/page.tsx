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

  const rawPending = pendingSnap ? await getSnapshotPreview(pendingSnap.id) : null;
  const pending: Preview | null = rawPending
    ? {
        ...rawPending,
        queryPeriodStart: rawPending.queryPeriodStart instanceof Date
          ? rawPending.queryPeriodStart.toISOString().slice(0, 10)
          : rawPending.queryPeriodStart ?? null,
        queryPeriodEnd: rawPending.queryPeriodEnd instanceof Date
          ? rawPending.queryPeriodEnd.toISOString().slice(0, 10)
          : rawPending.queryPeriodEnd ?? null,
      }
    : null;

  const recentApplied: UploadLogEntry[] = appliedSnaps.map((e) => ({
    id: e.id,
    originalFilename: e.originalFilename,
    appliedAt: e.appliedAt instanceof Date ? e.appliedAt.toISOString() : (e.appliedAt as string | null),
    queryPeriodStart: e.queryPeriodStart instanceof Date
      ? e.queryPeriodStart.toISOString().slice(0, 10)
      : (e.queryPeriodStart as string | null),
    uploadedAt: e.uploadedAt instanceof Date ? e.uploadedAt.toISOString() : (e.uploadedAt as string),
  }));

  return (
    <UploadClient
      initialPending={pending}
      initialRecentApplied={recentApplied}
    />
  );
}
