import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { getSnapshotPreview } from "@/lib/services/snapshotService";
import { ensureSyncState } from "@/lib/services/mdbSyncService";
import { UploadClient } from "./UploadClient";
import type { Preview, UploadLogEntry } from "@/lib/types";

export default async function UploadPage() {
  const hospitalId = await getCurrentHospitalId();
  await ensureSyncState(hospitalId);

  const [pendingSnap, appliedSnaps, mdbState] = await Promise.all([
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
    prisma.mdbSyncState.findUnique({
      where: { hospitalId },
      select: { agentKey: true, lastIndex: true, lastSyncedAt: true },
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

  const recentApplied: UploadLogEntry[] = appliedSnaps.map((snap) => ({
    id: snap.id,
    originalFilename: snap.originalFilename,
    appliedAt: snap.appliedAt instanceof Date ? snap.appliedAt.toISOString() : (snap.appliedAt as string | null),
    queryPeriodStart: snap.queryPeriodStart instanceof Date
      ? snap.queryPeriodStart.toISOString().slice(0, 10)
      : (snap.queryPeriodStart as string | null),
    uploadedAt: snap.uploadedAt instanceof Date ? snap.uploadedAt.toISOString() : (snap.uploadedAt as string),
  }));

  return (
    <UploadClient
      initialPending={pending}
      initialRecentApplied={recentApplied}
      initialMdbState={
        mdbState
          ? {
              agentKey: mdbState.agentKey ?? null,
              lastIndex: mdbState.lastIndex,
              lastSyncedAt: mdbState.lastSyncedAt instanceof Date
                ? mdbState.lastSyncedAt.toISOString()
                : (mdbState.lastSyncedAt as string | null),
            }
          : null
      }
    />
  );
}
