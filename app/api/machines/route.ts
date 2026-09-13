import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const machines = await prisma.machine.findMany({
      where: { hospitalId },
      orderBy: { name: "asc" },
      include: { _count: { select: { cassettes: true } } },
    });
    return ok(machines);
  });
}
