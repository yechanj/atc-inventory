import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, handle } from "@/lib/api";
import { ensureSyncState, rotateAgentKey } from "@/lib/services/mdbSyncService";

export const dynamic = "force-dynamic";

/** 현재 MDB 동기화 상태 조회 (MdbSyncState 없으면 자동 생성) */
export async function GET() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    await ensureSyncState(hospitalId);
    const state = await prisma.mdbSyncState.findUnique({
      where: { hospitalId },
      select: { agentKey: true, lastIndex: true, lastSyncedAt: true },
    });
    return ok({
      agentKey: state?.agentKey ?? null,
      lastIndex: state?.lastIndex ?? 0,
      lastSyncedAt: state?.lastSyncedAt ?? null,
    });
  });
}

/** agentKey 재발급 */
export async function POST() {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const agentKey = await rotateAgentKey(hospitalId);
    return ok({ agentKey });
  });
}
