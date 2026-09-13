import { ok, handle } from "@/lib/api";
import { cancelSnapshot } from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await cancelSnapshot(params.id);
    return ok({ canceled: true });
  });
}
