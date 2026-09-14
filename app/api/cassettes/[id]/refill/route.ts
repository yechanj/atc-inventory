import { ok, fail, handle } from "@/lib/api";
import { refillCassette } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = await req.json();
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
