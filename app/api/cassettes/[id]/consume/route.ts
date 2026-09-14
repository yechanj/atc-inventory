import { ok, fail, handle } from "@/lib/api";
import { consumeCassette } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = await req.json();
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail("소모 수량은 0보다 커야 합니다.");
    }
    const result = await consumeCassette({
      cassetteId: params.id,
      quantity,
      memo: body.memo,
    });
    return ok(result);
  });
}
