import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 테스트용 전체 초기화.
 * Machine/Cassette/Snapshot/History 전부 삭제 → 다음 업로드 시 자동 부트스트랩.
 */
export async function POST() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();

    const machines = await prisma.machine.findMany({ where: { hospitalId } });
    const machineIds = machines.map((m) => m.id);

    const cassettes = await prisma.cassette.findMany({
      where: { machineId: { in: machineIds } },
    });
    const cassetteIds = cassettes.map((c) => c.id);

    await prisma.$transaction([
      // FK 순서: InventoryHistory → UsageSnapshot(cascade lines) → Cassette → Machine
      prisma.inventoryHistory.deleteMany({
        where: { cassetteId: { in: cassetteIds } },
      }),
      prisma.usageSnapshot.deleteMany({ where: { hospitalId } }),
      prisma.cassette.deleteMany({ where: { id: { in: cassetteIds } } }),
      prisma.machine.deleteMany({ where: { id: { in: machineIds } } }),
    ]);

    return ok({
      machinesDeleted: machineIds.length,
      cassettesDeleted: cassetteIds.length,
    });
  });
}
