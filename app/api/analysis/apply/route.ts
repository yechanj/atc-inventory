import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const body = await req.json();

    const items: { cassetteId: string; threshold: number }[] = Array.isArray(body.items)
      ? body.items.filter(
          (it: unknown) =>
            it !== null &&
            typeof it === "object" &&
            typeof (it as Record<string, unknown>).cassetteId === "string" &&
            Number.isFinite(Number((it as Record<string, unknown>).threshold))
        ).map((it: Record<string, unknown>) => ({
          cassetteId: String(it.cassetteId),
          threshold: Number(it.threshold),
        }))
      : [];

    if (items.length === 0) return fail("적용할 항목이 없습니다.");

    // ownership 검증
    const owned = await prisma.cassette.findMany({
      where: { id: { in: items.map((i) => i.cassetteId) }, machine: { hospitalId } },
      select: { id: true },
    });
    const allowedIds = new Set(owned.map((c) => c.id));
    const safeItems = items.filter((i) => allowedIds.has(i.cassetteId));

    if (safeItems.length === 0) return fail("접근 권한이 없습니다.", 403);

    await prisma.$transaction(
      safeItems.map((item) =>
        prisma.cassette.update({
          where: { id: item.cassetteId },
          data: { refillThreshold: item.threshold },
        })
      )
    );

    return ok({ updated: safeItems.length });
  });
}
