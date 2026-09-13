import { ok, handle } from "@/lib/api";
import { applySnapshot } from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const result = await applySnapshot(params.id);
    return ok(result);
  });
}
