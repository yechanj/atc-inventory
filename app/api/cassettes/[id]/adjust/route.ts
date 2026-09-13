import { ok, fail, handle } from "@/lib/api";
import { adjustCassette } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = await req.json();
    const actualQuantity = Number(body.actualQuantity);
    if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
      return fail("실재고는 0 이상의 숫자여야 합니다.");
    }
    const result = await adjustCassette({
      cassetteId: params.id,
      actualQuantity,
      memo: body.memo,
    });
    return ok(result);
  });
}
