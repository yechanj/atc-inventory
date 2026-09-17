import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import {
  prepareSnapshot,
  ExistingPendingError,
  ParseError,
  getSnapshotPreview,
} from "@/lib/services/snapshotService";
import type { Preview, UploadLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
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

    return ok({ pending, recentApplied });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("파일이 없습니다.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const hospitalId = await getCurrentHospitalId();

    const parseDate = (s: FormDataEntryValue | null) =>
      typeof s === "string" && s ? new Date(s + "T00:00:00Z") : undefined;

    try {
      const preview = await prepareSnapshot({
        hospitalId,
        originalFilename: file.name,
        buffer,
        queryPeriodStart: parseDate(form.get("queryPeriodStart")),
        queryPeriodEnd: parseDate(form.get("queryPeriodEnd")),
      });
      return ok(preview);
    } catch (e) {
      if (e instanceof ExistingPendingError) {
        return fail("대기 중인 파일이 있습니다. 먼저 반영하거나 취소하세요.", 409, {
          code: "EXISTING_PENDING",
          existingId: e.existingId,
        });
      }
      if (e instanceof ParseError) {
        return fail(`파일을 읽을 수 없습니다: ${e.message}`, 422, { code: "PARSE_ERROR" });
      }
      throw e;
    }
  });
}
