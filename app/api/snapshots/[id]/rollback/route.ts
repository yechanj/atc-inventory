import { ok, fail, handle } from "@/lib/api";
import { getCurrentHospitalId } from "@/lib/hospital";
import { rollbackSnapshot } from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    if (!hospitalId) return fail("인증이 필요합니다.", 401);
    const result = await rollbackSnapshot(params.id, hospitalId);
    return ok(result);
  });
}
