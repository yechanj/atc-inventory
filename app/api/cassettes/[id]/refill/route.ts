import { prisma } from "@/lib/prisma";
import { ok, fail, handle } from "@/lib/api";
import { refillCassette } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = await req.json();

    // 만충 보충: 만충량 - 현재고를 수량으로 계산
    if (body.fillToCapacity) {
      const cassette = await prisma.cassette.findUnique({ where: { id: params.id } });
      if (!cassette) return fail("카세트를 찾을 수 없습니다.", 404);
      if (!cassette.fullCapacity) return fail("만충량이 설정되지 않은 카세트입니다.");
      const quantity = cassette.fullCapacity - cassette.currentInventory;
      if (quantity <= 0) return fail("현재고가 이미 만충량 이상입니다.");
      const result = await refillCassette({
        cassetteId: params.id,
        quantity,
        memo: `만충 보충 (만충량 ${cassette.fullCapacity}정)`,
      });
      return ok(result);
    }

    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail("보충 수량은 0보다 커야 합니다.");
    }
    const result = await refillCassette({
      cassetteId: params.id,
      quantity,
      memo: body.memo,
      ...(body.recommendedPackages !== undefined && {
        recommendedPackages: body.recommendedPackages === null ? null : Number(body.recommendedPackages),
      }),
    });
    return ok(result);
  });
}
