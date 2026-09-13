import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { applyStocktake } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

/** 재고조사 대상 목록 (전체 카세트, 카세트번호순) */
export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const cassettes = await prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      include: { machine: { select: { name: true } } },
    });
    cassettes.sort((a, b) => {
      if (a.machine.name !== b.machine.name) return a.machine.name.localeCompare(b.machine.name);
      return a.cassetteNumber - b.cassetteNumber;
    });
    return ok(cassettes);
  });
}

/** 재고조사 일괄 반영 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const parsed = entries
      .map((e: any) => ({
        cassetteId: String(e.cassetteId),
        actualQuantity: Number(e.actualQuantity),
      }))
      .filter((e: any) => e.cassetteId && Number.isFinite(e.actualQuantity));
    const result = await applyStocktake({ entries: parsed, memo: body.memo });
    return ok(result);
  });
}
