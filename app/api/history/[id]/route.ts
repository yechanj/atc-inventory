import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();

    const entry = await prisma.inventoryHistory.findUnique({
      where: { id: params.id },
      include: { cassette: { select: { machine: { select: { hospitalId: true } } } } },
    });

    if (!entry) return fail("이력을 찾을 수 없습니다.", 404);
    if (entry.cassette.machine.hospitalId !== hospitalId)
      return fail("권한이 없습니다.", 403);
    if (entry.type !== "REFILL")
      return fail("보충 이력만 삭제할 수 있습니다.", 400);

    await prisma.$transaction(async (tx) => {
      await tx.cassette.update({
        where: { id: entry.cassetteId },
        data: { currentInventory: { decrement: entry.changeQuantity } },
      });
      await tx.inventoryHistory.delete({ where: { id: params.id } });
    });

    return ok({ deleted: params.id });
  });
}
