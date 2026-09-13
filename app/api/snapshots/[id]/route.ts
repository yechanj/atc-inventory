import { ok, fail, handle } from "@/lib/api";
import { getSnapshotPreview } from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const preview = await getSnapshotPreview(params.id);
    if (!preview) return fail("스냅샷을 찾을 수 없습니다.", 404);
    return ok(preview);
  });
}
