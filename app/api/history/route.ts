import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") ?? "ALL";
    const cassetteId = searchParams.get("cassetteId") ?? undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);

    const where: any = { cassette: { machine: { hospitalId } } };
    if (type !== "ALL") where.type = type;
    if (cassetteId) where.cassetteId = cassetteId;

    const history = await prisma.inventoryHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        cassette: {
          select: {
            cassetteNumber: true,
            drugName: true,
            machine: { select: { name: true } },
          },
        },
      },
    });

    return ok(history);
  });
}
